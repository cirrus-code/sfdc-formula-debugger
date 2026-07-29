// Compile probe manifests into a deployable sfdx project + data script + plan:
//
//   probes/*.json + ../corpus/salesforce-v2.json
//     → sfdx/force-app/…/objects/FxProbe1__c/**   (object, input fields, one
//       formula field per probe × blank mode, TEXT() twins for exact capture)
//     → data.apex                                  (typed record inserts)
//     → plan.json                                  (what collect.ts reads back)
//
// Records are deduplicated by input-set: every distinct combination of field
// values becomes one record (keyed by hash in ProbeKey__c), and each probe row
// knows which record to read its formula field from.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  KEY_FIELD,
  OBJECT_API_NAME,
  type CorpusRef,
  type FieldSpec,
  type FieldType,
  type Plan,
  type PlanFormulaField,
  type PlanInputField,
  type PlanRow,
  type Probe,
  type ProbeReturn,
  type SemanticsManifest,
  type SyntaxManifest,
} from "./shared.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const CORPUS = join(ROOT, "..", "corpus", "salesforce-v2.json");
const SFDX = join(ROOT, "sfdx");
const OBJ_DIR = join(
  SFDX,
  "force-app",
  "main",
  "default",
  "objects",
  OBJECT_API_NAME,
);

interface CorpusRow {
  name: string;
  formula: string;
  dataType: string;
  fields: { name: string; type: string; value: string | null }[];
  blankMode: "zero" | "blank";
  expected: string;
}

// ---- field registry: union of every input field any probe references ----

interface FieldInfo {
  apiName: string;
  type: FieldType;
  maxScale: number;
  maxIntDigits: number;
  picklistValues: Set<string>;
}
const fieldReg = new Map<string, FieldInfo>(); // key: lowercased apiName

function registerField(
  apiName: string,
  type: FieldType,
  value: string | null,
): void {
  const key = apiName.toLowerCase();
  const existing = fieldReg.get(key);
  if (existing) {
    if (existing.type !== type) {
      throw new Error(
        `field type conflict for ${apiName}: ${existing.type} vs ${type} — add a fieldTypeOverride or rename in the manifest`,
      );
    }
  } else {
    fieldReg.set(key, {
      apiName,
      type,
      maxScale: 0,
      maxIntDigits: 0,
      picklistValues: new Set(),
    });
  }
  const info = fieldReg.get(key)!;
  if (value !== null && value !== "") {
    if (type === "Number" || type === "Currency" || type === "Percent") {
      if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) {
        throw new Error(`non-numeric value for ${apiName}: ${value}`);
      }
      const frac = value.split(".")[1] ?? "";
      info.maxScale = Math.max(info.maxScale, frac.length);
      info.maxIntDigits = Math.max(
        info.maxIntDigits,
        value.replace(/^-|\..*$/g, "").length,
      );
    }
    if (type === "Text" && value.length > 255) {
      throw new Error(`text value for ${apiName} exceeds 255 chars`);
    }
    if (type === "Picklist") {
      info.picklistValues.add(value);
    }
    if (type === "Multipicklist") {
      for (const v of value.split(";")) {
        info.picklistValues.add(v);
      }
    }
  }
}

// ---- record registry: distinct input-sets → one record each ----

const records = new Map<string, Record<string, FieldSpec>>();

function recordKeyFor(
  fields: readonly { name: string; type: FieldType; value: string | null }[],
): string {
  const present = fields
    .filter((f) => f.value !== null && f.value !== "")
    .map((f) => [f.name.toLowerCase(), f.value] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const key =
    present.length === 0
      ? "empty"
      : createHash("sha1")
          .update(JSON.stringify(present))
          .digest("hex")
          .slice(0, 12);
  if (!records.has(key)) {
    const rec: Record<string, FieldSpec> = {};
    for (const f of fields) {
      if (f.value !== null && f.value !== "") {
        rec[f.name.toLowerCase()] = { type: f.type, value: f.value };
      }
    }
    records.set(key, rec);
  }
  return key;
}

// ---- probe expansion ----

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const formulaFields: PlanFormulaField[] = [];

function addFormulaField(
  probeId: string,
  question: string,
  mode: "zero" | "blank",
  formula: string,
  returns: ProbeReturn,
  rows: PlanRow[],
  expectSaveError: boolean | "maybe" | undefined,
  interpret: Readonly<Record<string, string>> | undefined,
  fieldAliases?: Readonly<Record<string, string>>,
  envSpecific?: boolean,
  noCorpus?: boolean,
): void {
  // API name from the bare id (source prefix and corpus "test" prefix add no
  // information and blow the 40-char CustomField limit).
  let base = sanitizeId(probeId.replace(/^[a-z]+:/, "").replace(/^test/, ""));
  if (base.length > 34) {
    base = `${base.slice(0, 26)}_${createHash("sha1").update(base).digest("hex").slice(0, 7)}`;
  }
  const prefix = mode === "zero" ? "Pz" : "Pb";
  const apiName = `${prefix}_${base}__c`;
  formulaFields.push({
    apiName,
    probeId,
    question,
    blankMode: mode,
    formula,
    returns,
    expectSaveError,
    envSpecific,
    noCorpus,
    interpret,
    fieldAliases,
    rows,
  });
  // TEXT() twin: numbers/dates read back through SOQL/JSON lose precision and
  // rendering; TEXT(expr) captures the engine's own exact rendering as a string.
  const twinnable: ProbeReturn[] = [
    "Number",
    "Currency",
    "Percent",
    "Date",
    "Datetime",
    "Time",
  ];
  if (twinnable.includes(returns) && expectSaveError !== true) {
    formulaFields.push({
      apiName: `${mode === "zero" ? "Tz" : "Tb"}_${base}__c`,
      probeId,
      question,
      blankMode: mode,
      formula: `TEXT(${formula})`,
      returns: "Text",
      twinOf: apiName,
      expectSaveError,
      interpret,
      fieldAliases,
      rows,
    });
  }
}

function expandProbe(source: string, probe: Probe): void {
  const modes: ("zero" | "blank")[] =
    probe.blankMode === "both"
      ? ["zero", "blank"]
      : [probe.blankMode ?? "blank"];
  const fields = Object.entries(probe.fields ?? {}).map(([name, spec]) => {
    registerField(name, spec.type, spec.value);
    return { name, type: spec.type, value: spec.value };
  });
  const row: PlanRow = { recordKey: recordKeyFor(fields), fields };
  for (const mode of modes) {
    addFormulaField(
      `${source}:${probe.id}`,
      probe.question,
      mode,
      probe.formula,
      probe.returns,
      [row],
      probe.expectSaveError,
      probe.interpret,
      undefined,
      probe.envSpecific,
      probe.noCorpus,
    );
  }
}

function corpusReturnType(dataType: string): ProbeReturn {
  switch (dataType.toLowerCase()) {
    case "double":
    case "integer":
    case "long":
    case "number":
      return "Number";
    case "currency":
      return "Currency";
    case "percent":
      return "Percent";
    case "text":
    case "string":
      return "Text";
    case "boolean":
      return "Checkbox";
    case "dateonly":
      return "Date";
    case "datetime":
      return "Datetime";
    case "timeonly":
      return "Time";
    default:
      throw new Error(`unmapped corpus dataType: ${dataType}`);
  }
}

function corpusFieldType(
  type: string,
  name: string,
  ref: CorpusRef,
): FieldType {
  const override = Object.entries(ref.fieldTypeOverrides ?? {}).find(
    ([n]) => n.toLowerCase() === name.toLowerCase(),
  );
  if (override) {
    return override[1];
  }
  const known: FieldType[] = [
    "Number",
    "Text",
    "Date",
    "Datetime",
    "Boolean",
    "Time",
    "Currency",
    "Percent",
  ];
  if ((known as string[]).includes(type)) {
    return type as FieldType;
  }
  throw new Error(
    `corpus field ${name} has unmapped type "${type}" — add a fieldTypeOverride`,
  );
}

function expandCorpusRef(
  refIndex: number,
  ref: CorpusRef,
  corpus: CorpusRow[],
): void {
  const rows = corpus.filter((r) => r.name === ref.name);
  if (rows.length === 0) {
    throw new Error(`corpusRef not found: ${ref.name}`);
  }

  // Namespace this test's input fields (x<refIndex>_<name>): the same corpus
  // field name is reused across tests with incompatible value ranges, and one
  // org field can only have one scale.
  const aliasByOriginal = new Map<string, string>(); // original lowercased → alias
  const fieldAliases: Record<string, string> = {}; // alias lowercased → original
  for (const r of rows) {
    for (const f of r.fields) {
      const lower = f.name.toLowerCase();
      if (!aliasByOriginal.has(lower)) {
        const alias = `x${refIndex}_${lower.replace(/__c$/, "")}__c`;
        if (alias.length > 40) {
          throw new Error(`alias too long: ${alias}`);
        }
        aliasByOriginal.set(lower, alias);
        fieldAliases[alias.toLowerCase()] = f.name;
      }
    }
  }
  const aliasFormula = (formula: string): string => {
    let out = formula;
    for (const [original, alias] of aliasByOriginal) {
      out = out.replace(new RegExp(`\\b${original}\\b`, "gi"), alias);
    }
    return out;
  };

  const formulas = [...new Set(rows.map((r) => r.formula))];
  for (const [fi, formula] of formulas.entries()) {
    const suffix = formulas.length > 1 ? `_f${fi + 1}` : "";
    for (const mode of ["zero", "blank"] as const) {
      const modeRows = rows.filter(
        (r) => r.formula === formula && r.blankMode === mode,
      );
      if (modeRows.length === 0) {
        continue;
      }
      const seen = new Map<string, PlanRow>();
      for (const r of modeRows) {
        const fields = r.fields.map((f) => {
          const type = corpusFieldType(f.type, f.name, ref);
          const alias = aliasByOriginal.get(f.name.toLowerCase())!;
          registerField(alias, type, f.value === "" ? null : f.value);
          return { name: alias, type, value: f.value === "" ? null : f.value };
        });
        const key = recordKeyFor(fields);
        if (!seen.has(key)) {
          seen.set(key, { recordKey: key, fields, oracleExpected: r.expected });
        }
      }
      addFormulaField(
        `corpus:${ref.name}${suffix}`,
        ref.question,
        mode,
        aliasFormula(formula),
        corpusReturnType(rows[0].dataType),
        [...seen.values()],
        ref.expectSaveError,
        undefined,
        fieldAliases,
      );
    }
  }
}

// ---- metadata XML ----

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fieldXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}</CustomField>\n`;
}

function inputFieldXml(f: PlanInputField): string {
  const label = f.apiName.replace(/__c$/, "");
  const lines = [
    `    <fullName>${f.apiName}</fullName>`,
    `    <label>${label}</label>`,
  ];
  switch (f.type) {
    case "Number":
    case "Currency":
    case "Percent":
      lines.push(
        `    <type>${f.type}</type>`,
        `    <precision>18</precision>`,
        `    <scale>${f.scale ?? 0}</scale>`,
      );
      break;
    case "Text":
      lines.push(`    <type>Text</type>`, `    <length>255</length>`);
      break;
    case "TextArea":
      lines.push(`    <type>TextArea</type>`);
      break;
    case "Boolean":
      lines.push(
        `    <type>Checkbox</type>`,
        `    <defaultValue>false</defaultValue>`,
      );
      break;
    case "Date":
    case "Time":
      lines.push(`    <type>${f.type}</type>`);
      break;
    case "Datetime":
      lines.push(`    <type>DateTime</type>`);
      break;
    case "Multipicklist":
    case "Picklist": {
      const values = (f.picklistValues ?? [])
        .map(
          (v) =>
            `            <value>\n                <fullName>${xmlEscape(v)}</fullName>\n                <default>false</default>\n                <label>${xmlEscape(v)}</label>\n            </value>`,
        )
        .join("\n");
      lines.push(
        `    <type>${f.type === "Multipicklist" ? "MultiselectPicklist" : "Picklist"}</type>`,
        `    <valueSet>\n        <restricted>true</restricted>\n        <valueSetDefinition>\n            <sorted>false</sorted>\n${values}\n        </valueSetDefinition>\n    </valueSet>`,
      );
      if (f.type === "Multipicklist") {
        lines.push(`    <visibleLines>3</visibleLines>`);
      }
      break;
    }
  }
  return fieldXml(lines.join("\n") + "\n");
}

function formulaFieldXml(ff: PlanFormulaField): string {
  const label = ff.apiName.replace(/__c$/, "");
  const blanks = ff.blankMode === "zero" ? "BlankAsZero" : "BlankAsBlank";
  const lines = [
    `    <fullName>${ff.apiName}</fullName>`,
    `    <label>${label}</label>`,
    `    <formula>${xmlEscape(ff.formula)}</formula>`,
    `    <formulaTreatBlanksAs>${blanks}</formulaTreatBlanksAs>`,
  ];
  switch (ff.returns) {
    case "Number":
      lines.push(
        `    <type>Number</type>`,
        `    <precision>18</precision>`,
        `    <scale>8</scale>`,
      );
      break;
    case "Currency":
      lines.push(
        `    <type>Currency</type>`,
        `    <precision>18</precision>`,
        `    <scale>2</scale>`,
      );
      break;
    case "Percent":
      lines.push(
        `    <type>Percent</type>`,
        `    <precision>18</precision>`,
        `    <scale>8</scale>`,
      );
      break;
    case "Text":
      lines.push(`    <type>Text</type>`);
      break;
    case "Checkbox":
      lines.push(`    <type>Checkbox</type>`);
      break;
    case "Date":
      lines.push(`    <type>Date</type>`);
      break;
    case "Datetime":
      lines.push(`    <type>DateTime</type>`);
      break;
    case "Time":
      lines.push(`    <type>Time</type>`);
      break;
  }
  return fieldXml(lines.join("\n") + "\n");
}

const OBJECT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Fx Probe 1</label>
    <pluralLabel>Fx Probes 1</pluralLabel>
    <nameField>
        <type>AutoNumber</type>
        <label>Probe Nr</label>
        <displayFormat>P-{0000}</displayFormat>
    </nameField>
    <deploymentStatus>Deployed</deploymentStatus>
    <sharingModel>ReadWrite</sharingModel>
</CustomObject>
`;

// ---- data.apex ----

function apexString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}

function apexValue(spec: FieldSpec): string {
  const v = spec.value ?? "";
  switch (spec.type) {
    case "Number":
    case "Currency":
    case "Percent":
      return v;
    case "Boolean":
      return v === "true" ? "true" : "false";
    case "Text":
    case "TextArea":
    case "Picklist":
    case "Multipicklist":
      return apexString(v);
    case "Date": {
      const [y, m, d] = v.split(":").map(Number);
      return `Date.newInstance(${y}, ${m}, ${d})`;
    }
    case "Datetime": {
      const [y, m, d, hh = 0, mm = 0, ss = 0] = v.split(":").map(Number);
      return `Datetime.newInstanceGmt(${y}, ${m}, ${d}, ${hh}, ${mm}, ${ss})`;
    }
    case "Time": {
      const [hh = 0, mm = 0, ss = 0] = v.split(":").map(Number);
      return `Time.newInstance(${hh}, ${mm}, ${ss}, 0)`;
    }
  }
}

// Execute-anonymous rejects large scripts ("Script too large"), so the load is
// split into chunked scripts; the first chunk also wipes existing records.
const DATA_CHUNK_RECORDS = 60;

function dataApexChunks(): string[] {
  const entries = [...records];
  const chunks: string[] = [];
  for (let start = 0; start < entries.length; start += DATA_CHUNK_RECORDS) {
    const lines: string[] = [
      `// Generated by orgcheck generate.ts — loads probe records (chunk ${chunks.length + 1}).`,
    ];
    if (start === 0) {
      lines.push(`delete [SELECT Id FROM ${OBJECT_API_NAME} LIMIT 10000];`);
    }
    lines.push(`List<${OBJECT_API_NAME}> rs = new List<${OBJECT_API_NAME}>();`);
    let i = 0;
    for (const [key, rec] of entries.slice(start, start + DATA_CHUNK_RECORDS)) {
      const varName = `r${i++}`;
      lines.push(
        `${OBJECT_API_NAME} ${varName} = new ${OBJECT_API_NAME}(${KEY_FIELD} = '${key}');`,
      );
      for (const [name, spec] of Object.entries(rec)) {
        const apiName = fieldReg.get(name)!.apiName;
        lines.push(`${varName}.${apiName} = ${apexValue(spec)};`);
      }
      lines.push(`rs.add(${varName});`);
    }
    lines.push(
      `insert rs;`,
      `System.debug('inserted ' + rs.size() + ' probe records');`,
    );
    chunks.push(lines.join("\n") + "\n");
  }
  return chunks;
}

// ---- main ----

const syntax: SyntaxManifest = JSON.parse(
  readFileSync(join(ROOT, "probes", "syntax.json"), "utf8"),
);
const semantics: SemanticsManifest = JSON.parse(
  readFileSync(join(ROOT, "probes", "semantics.json"), "utf8"),
);
const corpus: CorpusRow[] = JSON.parse(readFileSync(CORPUS, "utf8"));

for (const probe of syntax.probes) {
  expandProbe("syntax", probe);
}
for (const [i, ref] of semantics.corpusRefs.entries()) {
  expandCorpusRef(i + 1, ref, corpus);
}
for (const probe of semantics.probes) {
  expandProbe("semantics", probe);
}

// A Number(18, scale) field can't always hold every value a corpus test throws
// at one field (e.g. 123456789.123456789 and .0000000000001 share a field).
// Storing an unfittable value would silently ROUND the probe's input, so such
// rows are dropped — loudly, never silently.
function valueFits(info: FieldInfo, value: string): boolean {
  const frac = (value.split(".")[1] ?? "").length;
  const intDigits = value.replace(/^-|\..*$/g, "").length;
  return frac <= info.maxScale && intDigits <= 18 - info.maxScale;
}
const droppedRows = new Set<string>();
const keptFormulaFields: PlanFormulaField[] = formulaFields.map((ff) => ({
  ...ff,
  rows: ff.rows.filter((row) => {
    const bad = row.fields.find((f) => {
      const info = fieldReg.get(f.name.toLowerCase())!;
      const numeric =
        info.type === "Number" ||
        info.type === "Currency" ||
        info.type === "Percent";
      return numeric && f.value !== null && !valueFits(info, f.value);
    });
    if (bad) {
      droppedRows.add(
        `${ff.probeId} [${ff.blankMode}]: ${bad.name} = ${bad.value}`,
      );
    }
    return !bad;
  }),
}));
formulaFields.length = 0;
formulaFields.push(...keptFormulaFields);
for (const msg of droppedRows) {
  console.warn(`DROPPED (input value unstorable at field scale): ${msg}`);
}
const referencedKeys = new Set(
  formulaFields.flatMap((ff) => ff.rows.map((r) => r.recordKey)),
);
for (const key of [...records.keys()]) {
  if (!referencedKeys.has(key)) {
    records.delete(key);
  }
}

const inputFields: PlanInputField[] = [...fieldReg.values()].map((info) => ({
  apiName: info.apiName,
  type: info.type,
  scale:
    info.type === "Number" ||
    info.type === "Currency" ||
    info.type === "Percent"
      ? info.maxScale
      : undefined,
  picklistValues: info.picklistValues.size
    ? [...info.picklistValues]
    : undefined,
}));

const totalFields = inputFields.length + formulaFields.length + 1;
if (totalFields > 400) {
  throw new Error(
    `${totalFields} custom fields exceeds the single-object budget — split the manifests or add object chunking`,
  );
}

rmSync(join(SFDX, "force-app"), { recursive: true, force: true });
mkdirSync(join(OBJ_DIR, "fields"), { recursive: true });
writeFileSync(join(OBJ_DIR, `${OBJECT_API_NAME}.object-meta.xml`), OBJECT_XML);
writeFileSync(
  join(OBJ_DIR, "fields", `${KEY_FIELD}.field-meta.xml`),
  fieldXml(
    `    <fullName>${KEY_FIELD}</fullName>\n    <label>Probe Key</label>\n    <type>Text</type>\n    <length>64</length>\n`,
  ),
);
for (const f of inputFields) {
  writeFileSync(
    join(OBJ_DIR, "fields", `${f.apiName}.field-meta.xml`),
    inputFieldXml(f),
  );
}
for (const ff of formulaFields) {
  writeFileSync(
    join(OBJ_DIR, "fields", `${ff.apiName}.field-meta.xml`),
    formulaFieldXml(ff),
  );
}
writeFileSync(
  join(SFDX, "sfdx-project.json"),
  JSON.stringify(
    {
      name: "orgcheck",
      packageDirectories: [{ path: "force-app", default: true }],
      sourceApiVersion: "62.0",
    },
    null,
    2,
  ) + "\n",
);
for (const stale of readdirSync(ROOT).filter((f) =>
  /^data(-\d+)?\.apex$/.test(f),
)) {
  rmSync(join(ROOT, stale));
}
const dataChunks = dataApexChunks();
for (const [i, chunk] of dataChunks.entries()) {
  writeFileSync(
    join(ROOT, `data-${String(i + 1).padStart(2, "0")}.apex`),
    chunk,
  );
}

const plan: Plan = {
  objectApiName: OBJECT_API_NAME,
  inputFields,
  formulaFields,
  records: Object.fromEntries(records),
};
writeFileSync(join(ROOT, "plan.json"), JSON.stringify(plan, null, 1));

console.log(
  `generated: ${inputFields.length} input fields, ${formulaFields.length} formula fields ` +
    `(${formulaFields.filter((f) => f.twinOf).length} twins), ${records.size} records`,
);
