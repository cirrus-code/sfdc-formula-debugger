// Wave 2: compile the per-context availability matrix into deployable
// metadata fragments.
//
//   src/registry/functions.ts (the one registry) + probes/contexts.json
//     → ctx-plan.json   (component fragments + batches; collect-ctx composes
//                        per-round packages from them)
//     → data-ctx.apex   (runtime validation-rule probe records)
//
// Unlike wave 1, no formula field is ever read back here: each probe is one
// metadata component per (construct × context container), and the deploy
// accept/reject — with its message — IS the observation. Containers that can
// reference record fields get typed input fields as arguments (no helper
// taint); detached containers (default value, flow, quick action, email) fall
// back to literals, with any helper functions recorded as taint so emit-ctx
// can refuse to over-conclude from a rejection.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FUNCTIONS } from "../../src/registry/functions.ts";
import type { FunctionSpec, SfType } from "../../src/registry/types.ts";
import type {
  CtxApprovalProbe,
  CtxBatch,
  CtxComponent,
  CtxContainerId,
  CtxFieldUpdateProbe,
  CtxFlowValueProbe,
  CtxPlan,
  CtxRuntimeProbe,
  CtxUntestable,
} from "./shared-ctx.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

interface InvocationOverride {
  formula: string;
  returns: SfType;
  taint?: string[];
}
interface GlobalProbe {
  name: string;
  formula: string;
  returns: SfType;
  support?: string;
  containers?: CtxContainerId[];
}
interface Manifest {
  invocationOverrides: Record<string, InvocationOverride>;
  globals: GlobalProbe[];
  runtimeProbes: CtxRuntimeProbe[];
  flowValueProbes: CtxFlowValueProbe[];
  fieldUpdateProbes: CtxFieldUpdateProbe[];
  approvalRuntimeProbes: CtxApprovalProbe[];
}
const manifest: Manifest = JSON.parse(
  readFileSync(join(ROOT, "probes", "contexts.json"), "utf8"),
);

const BOGUS = "FXBOGUSFN123(1)";

// ---- XML helpers ----

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- probe invocation synthesis ----

// Only these SfTypes appear as required params across the registry; the
// synthesizer throws on anything new so additions fail loudly.
const LITERALS: Partial<Record<SfType, { src: string; taint: string[] }>> = {
  Number: { src: "1", taint: [] },
  Text: { src: '"a"', taint: [] },
  Boolean: { src: "TRUE", taint: [] },
  Date: { src: "DATE(2026, 1, 1)", taint: ["DATE"] },
  Datetime: { src: 'DATETIMEVALUE("2026-01-01 00:00:00")', taint: ["DATETIMEVALUE"] },
  Time: { src: 'TIMEVALUE("12:00:00")', taint: ["TIMEVALUE"] },
  Unknown: { src: '"a"', taint: [] },
};

/** Field api names for typed args, present on every field-capable container
 * object. */
const CTX_FIELDS: Partial<Record<SfType, string>> = {
  Number: "CtxNum__c",
  Text: "CtxText__c",
  Boolean: "CtxBool__c",
  Date: "CtxDate__c",
  Datetime: "CtxDT__c",
  Time: "CtxTime__c",
  Picklist: "CtxPick__c",
  Multipicklist: "CtxMulti__c",
  Unknown: "CtxText__c",
};

interface Invocation {
  formula: string; // with {T:Type} / {F:Type} placeholders unresolved
  returns: SfType;
  taint: string[];
}

function synthesize(fn: FunctionSpec): Invocation {
  const override = manifest.invocationOverrides[fn.name];
  if (override) {
    return {
      formula: override.formula,
      returns: override.returns,
      taint: override.taint ?? [],
    };
  }
  const args: string[] = [];
  const argTypes: SfType[] = [];
  for (const p of fn.params) {
    if (p.optional) {
      continue;
    }
    // Two args for a variadic tail (AND, MAX, CONCATENATE…): a one-arg call
    // may be a special case org-side; two is the ordinary shape.
    const count = p.variadic ? 2 : 1;
    for (let i = 0; i < count; i++) {
      args.push(`{T:${p.type}}`);
      argTypes.push(p.type);
    }
  }
  const returns =
    fn.returnType.kind === "fixed"
      ? fn.returnType.type
      : (argTypes[fn.returnType.index] ?? "Unknown");
  return {
    formula: `${fn.name}(${args.join(", ")})`,
    returns: returns === "Unknown" ? "Text" : returns,
    taint: [],
  };
}

/** Resolve {T:...}/{F:...} placeholders for a container. Returns null when the
 * probe cannot be expressed there (field-only arg without fields, picklist
 * literal…). */
function resolve(
  inv: Invocation,
  fieldPrefix: string | null, // "" = bare field names, "Obj__c." = prefixed, null = literals only
): { formula: string; taint: string[] } | { untestable: string } {
  let out = inv.formula;
  const taint = [...inv.taint];
  let untestable: string | null = null;
  out = out.replace(/\{([TF]):([A-Za-z]+)\}/g, (whole, mode, type) => {
    const sfType = type as SfType;
    if (fieldPrefix !== null) {
      const field = CTX_FIELDS[sfType];
      if (field) {
        return `${fieldPrefix}${field}`;
      }
    }
    if (mode === "F") {
      untestable = `needs a real field reference (${type}) and this container cannot reference fields`;
      return whole;
    }
    const lit = LITERALS[sfType];
    if (!lit) {
      untestable = `no literal constructor for ${type} argument in a field-less container`;
      return whole;
    }
    taint.push(...lit.taint);
    return lit.src;
  });
  if (untestable) {
    return { untestable };
  }
  return { formula: out, taint: [...new Set(taint)] };
}

/** Boolean-required containers wrap non-boolean probes with the equality
 * operator only — no helper function, so no taint. */
function boolWrap(formula: string, returns: SfType): string {
  return returns === "Boolean" ? formula : `(${formula}) = (${formula})`;
}

function probeName(raw: string): string {
  return raw.replace(/^\$/, "G_").replace(/[^A-Za-z0-9]+/g, "_");
}

// ---- object / field XML fragments ----

function objectShellChild(): string {
  return [
    "    <deploymentStatus>Deployed</deploymentStatus>",
    "    <label>%LABEL%</label>",
    "    <nameField>\n        <type>AutoNumber</type>\n        <label>Nr</label>\n        <displayFormat>C-{0000}</displayFormat>\n    </nameField>",
    "    <pluralLabel>%LABEL%s</pluralLabel>",
    "    <sharingModel>ReadWrite</sharingModel>",
  ].join("\n");
}

type SimpleFieldType =
  | "Text"
  | "Number"
  | "Checkbox"
  | "Date"
  | "DateTime"
  | "Time"
  | "Picklist"
  | "MultiselectPicklist";

function fieldChild(
  apiName: string,
  type: SimpleFieldType,
  defaultValue?: string,
): string {
  const label = apiName.replace(/__c$/, "");
  const lines = [`        <fullName>${apiName}</fullName>`];
  if (defaultValue !== undefined && type !== "Picklist") {
    lines.push(`        <defaultValue>${esc(defaultValue)}</defaultValue>`);
  }
  lines.push(`        <label>${label}</label>`);
  if (type === "Text") {
    lines.push(`        <length>255</length>`);
  }
  if (type === "Number") {
    lines.push(
      `        <precision>18</precision>`,
      `        <scale>2</scale>`,
    );
  }
  lines.push(`        <type>${type}</type>`);
  if (type === "Checkbox" && defaultValue === undefined) {
    // Checkbox defaultValue is a literal, not a formula; a bare checkbox
    // needs one anyway.
    lines.splice(1, 0, `        <defaultValue>false</defaultValue>`);
  }
  if (type === "Picklist" || type === "MultiselectPicklist") {
    lines.push(
      `        <valueSet>\n            <restricted>true</restricted>\n            <valueSetDefinition>\n                <sorted>false</sorted>\n                <value>\n                    <fullName>a</fullName>\n                    <default>false</default>\n                    <label>a</label>\n                </value>\n                <value>\n                    <fullName>b</fullName>\n                    <default>false</default>\n                    <label>b</label>\n                </value>\n            </valueSetDefinition>\n        </valueSet>`,
    );
  }
  if (type === "MultiselectPicklist") {
    lines.push(`        <visibleLines>3</visibleLines>`);
  }
  return `    <fields>\n${lines.join("\n")}\n    </fields>`;
}

function validationRuleChild(
  name: string,
  formula: string,
  errorMessage: string,
  active = true,
): string {
  return [
    `    <validationRules>`,
    `        <fullName>${name}</fullName>`,
    `        <active>${active}</active>`,
    `        <errorConditionFormula>${esc(formula)}</errorConditionFormula>`,
    `        <errorMessage>${esc(errorMessage)}</errorMessage>`,
    `    </validationRules>`,
  ].join("\n");
}

function webLinkChild(name: string, formula: string): string {
  // openType newWindow requires an explicit window position.
  return [
    `    <webLinks>`,
    `        <fullName>${name}</fullName>`,
    `        <availability>online</availability>`,
    `        <displayType>link</displayType>`,
    `        <encodingKey>UTF-8</encodingKey>`,
    `        <linkType>url</linkType>`,
    `        <masterLabel>${name}</masterLabel>`,
    `        <openType>newWindow</openType>`,
    `        <position>none</position>`,
    `        <protected>false</protected>`,
    `        <url>/home/home.jsp?probe={!${esc(formula)}}</url>`,
    `    </webLinks>`,
  ].join("\n");
}

function workflowRuleChild(name: string, formula: string): string {
  return [
    `    <rules>`,
    `        <fullName>${name}</fullName>`,
    `        <active>true</active>`,
    `        <formula>${esc(formula)}</formula>`,
    `        <triggerType>onCreateOnly</triggerType>`,
    `    </rules>`,
  ].join("\n");
}

function fieldUpdateChild(
  name: string,
  targetField: string,
  formula: string,
): string {
  return [
    `    <fieldUpdates>`,
    `        <fullName>${name}</fullName>`,
    `        <field>${targetField}</field>`,
    `        <formula>${esc(formula)}</formula>`,
    `        <name>${name}</name>`,
    `        <notifyAssignee>false</notifyAssignee>`,
    `        <operation>Formula</operation>`,
    `        <protected>false</protected>`,
    `    </fieldUpdates>`,
  ].join("\n");
}

const FLOW_TYPES: Partial<Record<SfType, string>> = {
  Text: "String",
  Number: "Number",
  Boolean: "Boolean",
  Date: "Date",
  Datetime: "DateTime",
};

function flowXml(name: string, expression: string, returns: SfType): string {
  const dt = FLOW_TYPES[returns];
  if (!dt) {
    throw new Error(`no flow dataType for ${returns}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <assignments>
        <assignmentItems>
            <assignToReference>out</assignToReference>
            <operator>Assign</operator>
            <value>
                <elementReference>probe</elementReference>
            </value>
        </assignmentItems>
        <label>assign</label>
        <locationX>176</locationX>
        <locationY>134</locationY>
        <name>assign</name>
    </assignments>
    <formulas>
        <dataType>${dt}</dataType>
        <expression>${esc(expression)}</expression>
        <name>probe</name>
    </formulas>
    <interviewLabel>${name}</interviewLabel>
    <label>${name}</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <connector>
            <targetReference>assign</targetReference>
        </connector>
        <locationX>50</locationX>
        <locationY>0</locationY>
    </start>
    <status>Active</status>
    <variables>
        <dataType>${dt}</dataType>
        <isCollection>false</isCollection>
        <isInput>false</isInput>
        <isOutput>true</isOutput>
        <name>out</name>${dt === "Number" || dt === "Currency" ? "\n        <scale>2</scale>" : ""}
    </variables>
</Flow>
`;
}

const TARGET_FIELDS: Partial<Record<SfType, string>> = {
  Text: "TgtText__c",
  Number: "TgtNum__c",
  Boolean: "TgtBool__c",
  Date: "TgtDate__c",
  Datetime: "TgtDT__c",
  Time: "TgtTime__c",
};

function quickActionXml(
  name: string,
  targetObject: string,
  targetField: string,
  formula: string,
): string {
  // Create actions require a layout; it shows a dedicated layout-only field so
  // it can never collide with the override target.
  return `<?xml version="1.0" encoding="UTF-8"?>
<QuickAction xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldOverrides>
        <field>${targetField}</field>
        <formula>${esc(formula)}</formula>
    </fieldOverrides>
    <label>${name}</label>
    <optionsCreateFeedItem>false</optionsCreateFeedItem>
    <quickActionLayout>
        <layoutSectionStyle>TwoColumnsLeftToRight</layoutSectionStyle>
        <quickActionLayoutColumns>
            <quickActionLayoutItems>
                <emptySpace>false</emptySpace>
                <field>LayoutTxt__c</field>
                <uiBehavior>Edit</uiBehavior>
            </quickActionLayoutItems>
        </quickActionLayoutColumns>
        <quickActionLayoutColumns/>
    </quickActionLayout>
    <targetObject>${targetObject}</targetObject>
    <type>Create</type>
</QuickAction>
`;
}

function emailTemplateFiles(
  name: string,
  formula: string,
): { meta: string; body: string } {
  return {
    meta: `<?xml version="1.0" encoding="UTF-8"?>
<EmailTemplate xmlns="http://soap.sforce.com/2006/04/metadata">
    <available>true</available>
    <encodingKey>UTF-8</encodingKey>
    <name>${name}</name>
    <style>none</style>
    <subject>probe</subject>
    <type>text</type>
    <uiType>Aloha</uiType>
</EmailTemplate>
`,
    body: `probe: {!${formula}}\n`,
  };
}

function approvalXml(
  name: string,
  entryFormula: string,
  stepFormula: string | null,
): string {
  const stepCriteria = stepFormula
    ? `        <entryCriteria>\n            <formula>${esc(stepFormula)}</formula>\n        </entryCriteria>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApprovalProcess xmlns="http://soap.sforce.com/2006/04/metadata">
    <active>false</active>
    <allowRecall>true</allowRecall>
    <allowedSubmitters>
        <type>owner</type>
    </allowedSubmitters>
    <approvalStep>
        <allowDelegate>false</allowDelegate>
        <assignedApprover>
            <approver>
                <type>adhoc</type>
            </approver>
        </assignedApprover>
${stepCriteria}        <label>Step 1</label>
        <name>Step_1</name>
    </approvalStep>
    <entryCriteria>
        <formula>${esc(entryFormula)}</formula>
    </entryCriteria>
    <finalApprovalRecordLock>false</finalApprovalRecordLock>
    <finalRejectionRecordLock>false</finalRejectionRecordLock>
    <label>${name}</label>
    <recordEditability>AdminOnly</recordEditability>
    <showApprovalHistory>false</showApprovalHistory>
</ApprovalProcess>
`;
}

/** ACTIVE variant of approvalXml for the runtime channel: a real approver is
 * required before the org will activate, and a step that carries criteria needs
 * an explicit ifCriteriaNotMet so "criteria false" has an observable landing
 * place (final approval, no work item) distinct from an error. %APPROVER% is
 * resolved to the running org's username at deploy time — the plan itself stays
 * org-independent. */
function activeApprovalXml(
  name: string,
  entryFormula: string,
  stepFormula: string | null,
): string {
  const stepBody = stepFormula
    ? `        <entryCriteria>\n            <formula>${esc(stepFormula)}</formula>\n        </entryCriteria>\n        <ifCriteriaNotMet>ApproveRecord</ifCriteriaNotMet>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApprovalProcess xmlns="http://soap.sforce.com/2006/04/metadata">
    <active>true</active>
    <allowRecall>true</allowRecall>
    <allowedSubmitters>
        <type>owner</type>
    </allowedSubmitters>
    <approvalStep>
        <allowDelegate>false</allowDelegate>
        <assignedApprover>
            <approver>
                <name>%APPROVER%</name>
                <type>user</type>
            </approver>
            <whenMultipleApprovers>FirstResponse</whenMultipleApprovers>
        </assignedApprover>
${stepBody}        <label>Step 1</label>
        <name>Step_1</name>
        <rejectBehavior>
            <type>RejectRequest</type>
        </rejectBehavior>
    </approvalStep>
    <enableMobileDeviceAccess>false</enableMobileDeviceAccess>
    <entryCriteria>
        <formula>${esc(entryFormula)}</formula>
    </entryCriteria>
    <finalApprovalRecordLock>false</finalApprovalRecordLock>
    <finalRejectionRecordLock>false</finalRejectionRecordLock>
    <label>${name}</label>
    <recordEditability>AdminOnly</recordEditability>
    <showApprovalHistory>false</showApprovalHistory>
</ApprovalProcess>
`;
}

// ---- plan assembly ----

const components: CtxComponent[] = [];
const shells: Record<string, string> = {};
const untestable: CtxUntestable[] = [];
const batches: CtxBatch[] = [];

function addComponent(c: CtxComponent): void {
  if (components.some((x) => x.id === c.id)) {
    throw new Error(`duplicate component id: ${c.id}`);
  }
  components.push(c);
}

function objectFile(api: string): string {
  return `objects/${api}.object`;
}

function addObject(api: string, fields: [string, SimpleFieldType][]): void {
  const file = objectFile(api);
  shells[file] =
    `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</CustomObject>\n`;
  addComponent({
    id: `support:${api}`,
    kind: "support",
    mdType: "CustomObject",
    fullName: api,
    file,
    childXml: objectShellChild().replace(/%LABEL%/g, api.replace(/__c$/, "")),
  });
  for (const [f, type] of fields) {
    addComponent({
      id: `support:${api}.${f}`,
      kind: "support",
      mdType: "CustomField",
      fullName: `${api}.${f}`,
      file,
      childXml: fieldChild(f, type),
    });
  }
}

const CTX_FIELD_DEFS: [string, SimpleFieldType][] = [
  ["CtxText__c", "Text"],
  ["CtxNum__c", "Number"],
  ["CtxBool__c", "Checkbox"],
  ["CtxDate__c", "Date"],
  ["CtxDT__c", "DateTime"],
  ["CtxTime__c", "Time"],
  ["CtxPick__c", "Picklist"],
  ["CtxMulti__c", "MultiselectPicklist"],
];
const TGT_FIELD_DEFS: [string, SimpleFieldType][] = [
  ["TgtText__c", "Text"],
  ["TgtNum__c", "Number"],
  ["TgtBool__c", "Checkbox"],
  ["TgtDate__c", "Date"],
  ["TgtDT__c", "DateTime"],
  ["TgtTime__c", "Time"],
];

// Probe objects. Chunked per container so per-object caps (100 active VRs, 50
// active workflow rules) stay distant, and one container's quirks cannot
// contaminate another's object.
addObject("FxCtxV1__c", CTX_FIELD_DEFS);
addObject("FxCtxV2__c", CTX_FIELD_DEFS);
addObject("FxCtxW1__c", CTX_FIELD_DEFS);
addObject("FxCtxW2__c", CTX_FIELD_DEFS);
addObject("FxCtxW3__c", [...CTX_FIELD_DEFS, ...TGT_FIELD_DEFS]);
addObject("FxCtxW4__c", [...CTX_FIELD_DEFS, ...TGT_FIELD_DEFS]);
addObject("FxCtxW5__c", CTX_FIELD_DEFS);
addObject("FxCtxF__c", CTX_FIELD_DEFS);
addObject("FxCtxD__c", []);
addObject("FxCtxB__c", CTX_FIELD_DEFS);
addObject("FxCtxQ__c", [...TGT_FIELD_DEFS, ["LayoutTxt__c", "Text"]]);
addObject("FxCtxA1__c", CTX_FIELD_DEFS);
addObject("FxCtxA2__c", CTX_FIELD_DEFS);
addObject("FxCtxA3__c", CTX_FIELD_DEFS);
addObject("FxCtxA4__c", CTX_FIELD_DEFS);
addObject("FxRt__c", [
  ["Gate__c", "Text"],
  ["BlankN__c", "Number"],
  ["BlankT__c", "Text"],
]);
addObject("FxWfu__c", [
  ["Gate__c", "Text"],
  ["BlankN__c", "Number"],
  ["BlankT__c", "Text"],
  ["TgtText__c", "Text"],
  ["TgtNum__c", "Number"],
]);
// Approval runtime channel. Gated probes share an object because at most one
// active process's entry criteria can match a given record, but a criteria that
// may throw gets an object to itself: entry criteria are evaluated against every
// submission on the object, so one erroring process would otherwise decide every
// other probe's verdict on that object.
const APPROVAL_FIELD_DEFS: [string, SimpleFieldType][] = [
  ["Gate__c", "Text"],
  ["BlankN__c", "Number"],
  ["BlankT__c", "Text"],
];
const APPROVAL_CANARY_OBJECT = "FxApC__c";
const approvalObjects = [
  APPROVAL_CANARY_OBJECT,
  ...new Set(manifest.approvalRuntimeProbes.map((p) => p.object)),
];
for (const o of approvalObjects) {
  addObject(o, APPROVAL_FIELD_DEFS);
}

addObject("FxErr1__c", []);
addObject("FxErr2__c", []);
addObject("FxErr3__c", []);
addObject("FxErr4__c", []);

// Support metadata for the $Global probes.
shells["objects/FxSet__c.object"] =
  `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</CustomObject>\n`;
addComponent({
  id: "support:FxSet__c",
  kind: "support",
  mdType: "CustomObject",
  fullName: "FxSet__c",
  file: "objects/FxSet__c.object",
  childXml:
    "    <customSettingsType>Hierarchy</customSettingsType>\n    <enableFeeds>false</enableFeeds>\n    <label>FxSet</label>\n    <visibility>Public</visibility>",
});
addComponent({
  id: "support:FxSet__c.Val__c",
  kind: "support",
  mdType: "CustomField",
  fullName: "FxSet__c.Val__c",
  file: "objects/FxSet__c.object",
  childXml: fieldChild("Val__c", "Text"),
});
shells["objects/FxMeta__mdt.object"] =
  `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</CustomObject>\n`;
addComponent({
  id: "support:FxMeta__mdt",
  kind: "support",
  mdType: "CustomObject",
  fullName: "FxMeta__mdt",
  file: "objects/FxMeta__mdt.object",
  childXml:
    "    <label>FxMeta</label>\n    <pluralLabel>FxMetas</pluralLabel>\n    <visibility>Public</visibility>",
});
addComponent({
  id: "support:FxMeta__mdt.Val__c",
  kind: "support",
  mdType: "CustomField",
  fullName: "FxMeta__mdt.Val__c",
  file: "objects/FxMeta__mdt.object",
  childXml: fieldChild("Val__c", "Text"),
});
addComponent({
  id: "support:FxMeta.sample",
  kind: "support",
  mdType: "CustomMetadata",
  fullName: "FxMeta.sample",
  file: "customMetadata/FxMeta.sample.md",
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <label>sample</label>
    <protected>false</protected>
    <values>
        <field>Val__c</field>
        <value xsi:type="xsd:string">x</value>
    </values>
</CustomMetadata>
`,
});
shells["labels/CustomLabels.labels"] =
  `<?xml version="1.0" encoding="UTF-8"?>\n<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</CustomLabels>\n`;
addComponent({
  id: "support:FxLbl",
  kind: "support",
  mdType: "CustomLabel",
  fullName: "FxLbl",
  file: "labels/CustomLabels.labels",
  childXml:
    "    <labels>\n        <fullName>FxLbl</fullName>\n        <language>en_US</language>\n        <protected>false</protected>\n        <shortDescription>FxLbl</shortDescription>\n        <value>x</value>\n    </labels>",
});
addComponent({
  id: "support:FxPerm",
  kind: "support",
  mdType: "CustomPermission",
  fullName: "FxPerm",
  file: "customPermissions/FxPerm.customPermission",
  xml: `<?xml version="1.0" encoding="UTF-8"?>\n<CustomPermission xmlns="http://soap.sforce.com/2006/04/metadata">\n    <label>FxPerm</label>\n</CustomPermission>\n`,
});

// ---- per-container probe expansion ----

interface ProbeInput {
  id: string; // unique within the container
  kind: "canary_ok" | "canary_bogus" | "return_type" | "function" | "global";
  name?: string;
  inv: Invocation;
}

/** Every construct probed in a container, in stable order: canaries, the
 * function matrix, the globals, the return-type probe. Containers emit each
 * however their metadata shape requires. */
function probeList(container: CtxContainerId): ProbeInput[] {
  const probes: ProbeInput[] = [
    {
      id: "canary_ok",
      kind: "canary_ok",
      inv: { formula: "{OK}", returns: "Boolean", taint: [] },
    },
    {
      id: "canary_bogus",
      kind: "canary_bogus",
      inv: { formula: BOGUS, returns: "Text", taint: [] },
    },
  ];
  for (const fn of FUNCTIONS) {
    probes.push({
      id: `fn_${fn.name}`,
      kind: "function",
      name: fn.name,
      inv: synthesize(fn),
    });
  }
  for (const g of manifest.globals) {
    if (g.containers && !g.containers.includes(container)) {
      continue;
    }
    probes.push({
      id: `gl_${probeName(g.name)}`,
      kind: "global",
      name: g.name,
      inv: { formula: g.formula, returns: g.returns, taint: [] },
    });
  }
  probes.push({
    id: "return_type",
    kind: "return_type",
    inv: { formula: "{RETTYPE}", returns: "Unknown", taint: [] },
  });
  return probes;
}

function markUntestable(
  container: CtxContainerId,
  p: ProbeInput,
  reason: string,
): void {
  if (p.kind === "function" || p.kind === "global") {
    untestable.push({ container, kind: p.kind, name: p.name!, reason });
  }
}

function pushBatches(
  container: CtxContainerId,
  ids: { canary: string[]; matrix: string[] },
): void {
  batches.push(
    {
      id: `${container}:canary`,
      container,
      phase: "canary",
      componentIds: ids.canary,
    },
    {
      id: `${container}:matrix`,
      container,
      phase: "matrix",
      componentIds: ids.matrix,
    },
  );
}

/** Chunk matrix probes across host objects, canaries always on the first. */
function hostFor(objects: string[], index: number, perObject: number): string {
  return objects[Math.min(Math.floor(index / perObject), objects.length - 1)];
}


// --- formula_field: typed formula CustomFields, field-capable, no wrapper ---

{
  const container: CtxContainerId = "formula_field";
  const canary: string[] = [];
  const matrix: string[] = [];
  const FF_TYPES: Partial<Record<SfType, string>> = {
    Text: "Text",
    Number: "Number",
    Boolean: "Checkbox",
    Date: "Date",
    Datetime: "DateTime",
    Time: "Time",
  };
  for (const p of probeList(container)) {
    let formula: string;
    let returns: SfType;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
      returns = "Text";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
      returns = "Text";
    } else if (p.kind === "return_type") {
      formula = '"x"';
      returns = "Number"; // text formula declared as a Number field
    } else {
      const r = resolve(p.inv, "");
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      returns = p.inv.returns;
      taint = r.taint;
    }
    const ffType = FF_TYPES[returns];
    if (!ffType) {
      markUntestable(container, p, `no formula-field type for ${returns}`);
      continue;
    }
    const apiName = `FF_${probeName(p.id)}__c`;
    const label = apiName.replace(/__c$/, "");
    const typeLines = [
      `        <fullName>${apiName}</fullName>`,
      `        <formula>${esc(formula)}</formula>`,
      `        <formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>`,
      `        <label>${label}</label>`,
    ];
    if (ffType === "Number") {
      typeLines.push(
        `        <precision>18</precision>`,
        `        <scale>2</scale>`,
      );
    }
    typeLines.push(`        <type>${ffType}</type>`);
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "CustomField",
      fullName: `FxCtxF__c.${apiName}`,
      file: objectFile("FxCtxF__c"),
      childXml: `    <fields>\n${typeLines.join("\n")}\n    </fields>`,
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- validation_rule / workflow_rule / approval: boolean containers ---

function booleanContainer(
  container: CtxContainerId,
  objects: string[],
  emit: (host: string, name: string, formula: string, p: ProbeInput) => CtxComponent,
): void {
  const canary: string[] = [];
  const matrix: string[] = [];
  let i = 0;
  for (const p of probeList(container)) {
    let formula: string;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = "1 = 1";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
    } else if (p.kind === "return_type") {
      formula = "1 + 1";
    } else {
      const r = resolve(p.inv, "");
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = boolWrap(r.formula, p.inv.returns);
      taint = r.taint;
    }
    const host =
      p.kind === "function" || p.kind === "global"
        ? hostFor(objects, i++, 40)
        : objects[0];
    const name = probeName(p.id);
    const c = { ...emit(host, name, formula, p), taint };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

booleanContainer(
  "validation_rule",
  ["FxCtxV1__c", "FxCtxV2__c"],
  (host, name, formula, p) => ({
    id: `validation_rule:${p.id}`,
    kind: p.kind,
    container: "validation_rule",
    name: p.name,
    formula,
    mdType: "ValidationRule",
    fullName: `${host}.VR_${name}`,
    file: objectFile(host),
    childXml: validationRuleChild(`VR_${name}`, formula, `probe VR_${name}`),
  }),
);

booleanContainer(
  "workflow_rule",
  ["FxCtxW1__c", "FxCtxW2__c", "FxCtxW5__c"],
  (host, name, formula, p) => {
    const file = `workflows/${host}.workflow`;
    shells[file] ??=
      `<?xml version="1.0" encoding="UTF-8"?>\n<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</Workflow>\n`;
    return {
      id: `workflow_rule:${p.id}`,
      kind: p.kind,
      container: "workflow_rule",
      name: p.name,
      formula,
      mdType: "WorkflowRule",
      fullName: `${host}.WR_${name}`,
      file,
      childXml: workflowRuleChild(`WR_${name}`, formula),
    };
  },
);

function approvalContainer(
  container: "approval_entry" | "approval_step",
  objects: string[],
): void {
  booleanContainer(container, objects, (host, name, formula, p) => {
    const prefix = container === "approval_entry" ? "AE" : "AS";
    const apName = `${prefix}_${name}`;
    // Entry probes carry the formula as process entry criteria (trivial step);
    // step probes invert: trivial entry, formula on the step.
    const xml =
      container === "approval_entry"
        ? approvalXml(apName, formula, null)
        : approvalXml(apName, "1 = 1", formula);
    return {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      mdType: "ApprovalProcess",
      fullName: `${host}.${apName}`,
      file: `approvalProcesses/${host}.${apName}.approvalProcess`,
      xml,
    };
  });
}
approvalContainer("approval_entry", ["FxCtxA1__c", "FxCtxA2__c"]);
approvalContainer("approval_step", ["FxCtxA3__c", "FxCtxA4__c"]);

// --- workflow_field_update: typed target, raw expression ---

{
  const container: CtxContainerId = "workflow_field_update";
  const objects = ["FxCtxW3__c", "FxCtxW4__c"];
  const canary: string[] = [];
  const matrix: string[] = [];
  let i = 0;
  for (const p of probeList(container)) {
    let formula: string;
    let returns: SfType;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
      returns = "Text";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
      returns = "Text";
    } else if (p.kind === "return_type") {
      formula = '"x"';
      returns = "Number"; // text formula into a Number target — typing probe
    } else {
      const r = resolve(p.inv, "");
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      returns = p.inv.returns;
      taint = r.taint;
    }
    const target = TARGET_FIELDS[returns];
    if (!target) {
      markUntestable(container, p, `no target field type for ${returns}`);
      continue;
    }
    const host =
      p.kind === "function" || p.kind === "global"
        ? hostFor(objects, i++, 40)
        : objects[0];
    const file = `workflows/${host}.workflow`;
    shells[file] ??=
      `<?xml version="1.0" encoding="UTF-8"?>\n<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</Workflow>\n`;
    const name = `FU_${probeName(p.id)}`;
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "WorkflowFieldUpdate",
      fullName: `${host}.${name}`,
      file,
      childXml: fieldUpdateChild(name, target, formula),
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- default_value: one CustomField per probe, defaultValue = formula ---

{
  const container: CtxContainerId = "default_value";
  const canary: string[] = [];
  const matrix: string[] = [];
  for (const p of probeList(container)) {
    let formula: string;
    let returns: SfType;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
      returns = "Text";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
      returns = "Text";
    } else if (p.kind === "return_type") {
      formula = '"x"';
      returns = "Number";
    } else {
      const r = resolve(p.inv, null); // default values cannot reference fields
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      returns = p.inv.returns;
      taint = r.taint;
      if (returns === "Boolean") {
        // Checkbox defaults are literals, not formulas — carry boolean probes
        // on a Text field behind an IF (taint tracked).
        formula = `IF(${formula}, "y", "n")`;
        returns = "Text";
        taint = [...new Set([...taint, "IF"])];
      }
    }
    const fieldType: SimpleFieldType | undefined = (
      {
        Text: "Text",
        Number: "Number",
        Date: "Date",
        Datetime: "DateTime",
        Time: "Time",
      } as Partial<Record<SfType, SimpleFieldType>>
    )[returns];
    if (!fieldType) {
      markUntestable(container, p, `no field type for ${returns} default`);
      continue;
    }
    const apiName = `DV_${probeName(p.id)}__c`;
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "CustomField",
      fullName: `FxCtxD__c.${apiName}`,
      file: objectFile("FxCtxD__c"),
      childXml: fieldChild(apiName, fieldType, formula),
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- flow_formula: one Draft autolaunched flow per probe ---

{
  const container: CtxContainerId = "flow_formula";
  const canary: string[] = [];
  const matrix: string[] = [];
  for (const p of probeList(container)) {
    let formula: string;
    let returns: SfType;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
      returns = "Text";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
      returns = "Text";
    } else if (p.kind === "return_type") {
      formula = '"x"';
      returns = "Number";
    } else {
      const r = resolve(p.inv, null);
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      // Flow formulas reference globals through merge-field syntax.
      formula = p.kind === "global" ? `{!${r.formula}}` : r.formula;
      returns = p.inv.returns;
      taint = r.taint;
    }
    if (!FLOW_TYPES[returns]) {
      markUntestable(container, p, `no flow dataType for ${returns}`);
      continue;
    }
    const name = `FxFlow_${probeName(p.id)}`;
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "Flow",
      fullName: name,
      file: `flows/${name}.flow`,
      xml: flowXml(name, formula, returns),
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- quick_action: global Create action per probe ---

{
  const container: CtxContainerId = "quick_action";
  const canary: string[] = [];
  const matrix: string[] = [];
  for (const p of probeList(container)) {
    let formula: string;
    let returns: SfType;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
      returns = "Text";
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
      returns = "Text";
    } else if (p.kind === "return_type") {
      formula = '"x"';
      returns = "Number";
    } else {
      const r = resolve(p.inv, null);
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      returns = p.inv.returns;
      taint = r.taint;
    }
    const target = TARGET_FIELDS[returns];
    if (!target) {
      markUntestable(container, p, `no target field type for ${returns}`);
      continue;
    }
    const name = `FxQ_${probeName(p.id)}`;
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "QuickAction",
      fullName: name,
      file: `quickActions/${name}.quickAction`,
      xml: quickActionXml(name, "FxCtxQ__c", target, formula),
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- custom_button_link: WebLink children on FxCtxB__c ---

{
  const container: CtxContainerId = "custom_button_link";
  const canary: string[] = [];
  const matrix: string[] = [];
  for (const p of probeList(container)) {
    let formula: string;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
    } else if (p.kind === "return_type") {
      continue; // buttons impose no return type
    } else {
      // Buttons reference fields with an object-name prefix.
      const r = resolve(p.inv, "FxCtxB__c.");
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      taint = r.taint;
    }
    const name = `BL_${probeName(p.id)}`;
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "WebLink",
      fullName: `FxCtxB__c.${name}`,
      file: objectFile("FxCtxB__c"),
      childXml: webLinkChild(name, formula),
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// --- email_template: text template with a merge expression per probe ---

{
  const container: CtxContainerId = "email_template";
  const canary: string[] = [];
  const matrix: string[] = [];
  for (const p of probeList(container)) {
    let formula: string;
    let taint: string[] = [];
    if (p.kind === "canary_ok") {
      formula = '"ok"';
    } else if (p.kind === "canary_bogus") {
      formula = BOGUS;
    } else if (p.kind === "return_type") {
      continue;
    } else {
      const r = resolve(p.inv, null);
      if ("untestable" in r) {
        markUntestable(container, p, r.untestable);
        continue;
      }
      formula = r.formula;
      taint = r.taint;
    }
    const name = `FxE_${probeName(p.id)}`;
    const files = emailTemplateFiles(name, formula);
    const c: CtxComponent = {
      id: `${container}:${p.id}`,
      kind: p.kind,
      container,
      name: p.name,
      formula,
      taint,
      mdType: "EmailTemplate",
      fullName: `unfiled$public/${name}`,
      file: `email/unfiled$public/${name}.email-meta.xml`,
      xml: files.meta,
      extraFiles: { [`email/unfiled$public/${name}.email`]: files.body },
    };
    addComponent(c);
    (p.kind === "canary_ok" || p.kind === "canary_bogus" ? canary : matrix).push(
      c.id,
    );
  }
  pushBatches(container, { canary, matrix });
}

// ---- runtime probes: active gated VRs + probe records ----

const runtimeIds: string[] = [];
for (const rt of manifest.runtimeProbes) {
  const formula = rt.gate
    ? `AND(Gate__c = "${rt.gate}", ${rt.condition})`
    : rt.condition;
  const name = `RT_${probeName(rt.id)}`;
  addComponent({
    id: `runtime:${rt.id}`,
    kind: "runtime_rule",
    formula,
    mdType: "ValidationRule",
    fullName: `${rt.object}.${name}`,
    file: objectFile(rt.object),
    childXml: validationRuleChild(name, formula, `RTPROBE:${rt.id}`),
  });
  runtimeIds.push(`runtime:${rt.id}`);
}

// ---- field-update runtime probes: gated active rules + FU actions ----

const wfuIds: string[] = [];
{
  const file = "workflows/FxWfu__c.workflow";
  shells[file] ??=
    `<?xml version="1.0" encoding="UTF-8"?>\n<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">\n%CHILDREN%\n</Workflow>\n`;
  for (const fu of manifest.fieldUpdateProbes) {
    const base = probeName(fu.id);
    const target = fu.target === "Number" ? "TgtNum__c" : "TgtText__c";
    // One <fieldUpdates> + one gated active <rules> that fires it on create.
    addComponent({
      id: `wfuruntime:${fu.id}:update`,
      kind: "wfu_runtime",
      formula: fu.formula,
      mdType: "WorkflowFieldUpdate",
      fullName: `FxWfu__c.WFU_${base}`,
      file,
      childXml: fieldUpdateChild(`WFU_${base}`, target, fu.formula),
    });
    addComponent({
      id: `wfuruntime:${fu.id}:rule`,
      kind: "wfu_runtime",
      mdType: "WorkflowRule",
      fullName: `FxWfu__c.WFR_${base}`,
      file,
      childXml: [
        `    <rules>`,
        `        <fullName>WFR_${base}</fullName>`,
        `        <actions>`,
        `            <name>WFU_${base}</name>`,
        `            <type>FieldUpdate</type>`,
        `        </actions>`,
        `        <active>true</active>`,
        `        <formula>Gate__c = "${fu.id}"</formula>`,
        `        <triggerType>onCreateOnly</triggerType>`,
        `    </rules>`,
      ].join("\n"),
    });
    wfuIds.push(`wfuruntime:${fu.id}:update`, `wfuruntime:${fu.id}:rule`);
  }
}

// ---- approval runtime probes: ACTIVE approval processes, submit-time verdicts ----

const approvalCanaryIds: string[] = [];
const approvalProbeIds: string[] = [];
const approvalUpdateIds: string[] = [];
{
  function addApproval(
    id: string,
    object: string,
    name: string,
    entry: string,
    step: string | null,
    into: string[],
  ): void {
    addComponent({
      id,
      kind: "approval_runtime",
      formula: step ?? entry,
      mdType: "ApprovalProcess",
      fullName: `${object}.${name}`,
      file: `approvalProcesses/${object}.${name}.approvalProcess`,
      xml: activeApprovalXml(name, entry, step),
    });
    into.push(id);
  }

  const O = APPROVAL_CANARY_OBJECT;
  addApproval(
    "approvalcanary:ok",
    O,
    "APR_canary_ok",
    'Gate__c = "canary_ok"',
    null,
    approvalCanaryIds,
  );
  addApproval(
    "approvalcanary:bogus_entry",
    O,
    "APR_canary_bogus_entry",
    BOGUS,
    null,
    approvalCanaryIds,
  );
  addApproval(
    "approvalcanary:bogus_step",
    O,
    "APR_canary_bogus_step",
    'Gate__c = "canary_bogus_step"',
    BOGUS,
    approvalCanaryIds,
  );
  // The create-vs-update trap (flows and web links validate formulas on one
  // path only): this fullName lands valid in the canary batch, then the update
  // batch redeploys the same name with an unknown function. A clean update
  // deploy means the update path skips formula validation.
  addApproval(
    "approvalcanary:flip_ok",
    O,
    "APR_canary_flip",
    'Gate__c = "canary_flip"',
    null,
    approvalCanaryIds,
  );
  addApproval(
    "approvalupdate:flip_bogus",
    O,
    "APR_canary_flip",
    BOGUS,
    null,
    approvalUpdateIds,
  );

  for (const p of manifest.approvalRuntimeProbes) {
    const gateExpr = p.gate ? `Gate__c = "${p.gate}"` : null;
    let entry: string;
    if (p.context === "approval_entry") {
      entry = gateExpr ? `AND(${gateExpr}, ${p.formula})` : p.formula;
    } else {
      entry = gateExpr ?? "1 = 1";
    }
    const step = p.context === "approval_step" ? p.formula : null;
    addApproval(
      `approvalruntime:${p.id}`,
      p.object,
      `APR_${probeName(p.id)}`,
      entry,
      step,
      approvalProbeIds,
    );
  }
}

// ---- flow value probes: Active flows whose interview output is read back ----

const flowValueIds: string[] = [];
for (const fv of manifest.flowValueProbes) {
  const name = `FxFV_${probeName(fv.id)}`;
  addComponent({
    id: `flowvalue:${fv.id}`,
    kind: "flow_value",
    formula: fv.formula,
    mdType: "Flow",
    fullName: name,
    file: `flows/${name}.flow`,
    xml: flowXml(name, fv.formula, fv.returns as SfType),
  });
  flowValueIds.push(`flowvalue:${fv.id}`);
}

// ---- batches: support first, then containers, runtime rules last ----

batches.unshift({
  id: "support",
  phase: "support",
  componentIds: components
    .filter((c) => c.kind === "support")
    .map((c) => c.id),
});
batches.push({ id: "runtime", phase: "runtime", componentIds: runtimeIds });
batches.push({
  id: "flow_values",
  phase: "flow_values",
  componentIds: flowValueIds,
});
batches.push({ id: "wfu_runtime", phase: "wfu_runtime", componentIds: wfuIds });
batches.push({
  id: "approval_runtime:canary",
  phase: "approval_runtime",
  componentIds: approvalCanaryIds,
});
batches.push({
  id: "approval_runtime:probes",
  phase: "approval_runtime",
  componentIds: approvalProbeIds,
});
batches.push({
  id: "approval_runtime:update",
  phase: "approval_runtime",
  componentIds: approvalUpdateIds,
});

// ---- data-ctx.apex ----

function apexLines(): string {
  const lines: string[] = [
    "// Generated by generate-ctx.ts — runtime validation-rule probe records.",
    "// Each insert outcome is reported on the debug channel as",
    "//   CTXRESULT|<probeId>|SAVED  or  CTXRESULT|<probeId>|ERRRAW|<messages>",
  ];
  const objects = [...new Set(manifest.runtimeProbes.map((r) => r.object))];
  for (const o of objects) {
    lines.push(`delete [SELECT Id FROM ${o} LIMIT 10000];`);
  }
  lines.push(
    "List<SObject> rs = new List<SObject>();",
    "List<String> ids = new List<String>();",
  );
  for (const rt of manifest.runtimeProbes) {
    const fields = rt.gate ? `(Gate__c = '${rt.gate}')` : "()";
    lines.push(`rs.add(new ${rt.object}${fields});`, `ids.add('${rt.id}');`);
  }
  lines.push(
    "Database.SaveResult[] srs = Database.insert(rs, false);",
    "for (Integer i = 0; i < srs.size(); i++) {",
    "    if (srs[i].isSuccess()) {",
    "        System.debug('CTXRESULT|' + ids[i] + '|SAVED');",
    "    } else {",
    "        String m = '';",
    "        for (Database.Error er : srs[i].getErrors()) {",
    "            m += er.getStatusCode() + ': ' + er.getMessage() + ' ;; ';",
    "        }",
    "        System.debug('CTXRESULT|' + ids[i] + '|ERRRAW|' + m.replace('\\n', ' '));",
    "    }",
    "}",
  );
  return lines.join("\n") + "\n";
}

// ---- flows-run.apex: run each value-probe interview, report on the debug channel ----

function flowRunApex(): string {
  const lines: string[] = [
    "// Generated by generate-ctx.ts — runs the FxFV_* value-probe flows and",
    "// reports each interview's output variable:",
    "//   CTXRESULT|<probeId>|FLOWVAL|<value>  or  CTXRESULT|<probeId>|FLOWERR|<message>",
  ];
  for (const fv of manifest.flowValueProbes) {
    const name = `FxFV_${probeName(fv.id)}`;
    lines.push(
      "try {",
      `    Flow.Interview iv = Flow.Interview.createInterview('${name}', new Map<String, Object>());`,
      "    iv.start();",
      "    String v = String.valueOf(iv.getVariableValue('out'));",
      "    // Base64 the payload: the debug channel entity-encodes HTML, which",
      "    // would destroy encode-function outputs (their output IS entities).",
      "    String b64 = EncodingUtil.base64Encode(Blob.valueOf(v == null ? 'null' : v));",
      `    System.debug('CTXRESULT|${fv.id}|FLOWVAL64|' + b64);`,
      "} catch (Exception e) {",
      `    System.debug('CTXRESULT|${fv.id}|FLOWERR|' + e.getMessage().replace('\\n', ' '));`,
      "}",
    );
  }
  return lines.join("\n") + "\n";
}

// ---- wfu-run.apex: insert one gated record per field-update probe ----

function wfuRunApex(): string {
  const lines: string[] = [
    "// Generated by generate-ctx.ts — field-update runtime probe records.",
    "//   CTXRESULT|<probeId>|WFUSAVED|<recordId>  or  CTXRESULT|<probeId>|WFUERR|<messages>",
    "delete [SELECT Id FROM FxWfu__c LIMIT 10000];",
    "List<FxWfu__c> rs = new List<FxWfu__c>();",
    "List<String> ids = new List<String>();",
  ];
  for (const fu of manifest.fieldUpdateProbes) {
    lines.push(
      `rs.add(new FxWfu__c(Gate__c = '${fu.id}'));`,
      `ids.add('${fu.id}');`,
    );
  }
  lines.push(
    "Database.SaveResult[] srs = Database.insert(rs, false);",
    "for (Integer i = 0; i < srs.size(); i++) {",
    "    if (srs[i].isSuccess()) {",
    "        System.debug('CTXRESULT|' + ids[i] + '|WFUSAVED|' + srs[i].getId());",
    "    } else {",
    "        String m = '';",
    "        for (Database.Error er : srs[i].getErrors()) {",
    "            m += er.getStatusCode() + ': ' + er.getMessage() + ' ;; ';",
    "        }",
    "        System.debug('CTXRESULT|' + ids[i] + '|WFUERR|' + m.replace('\\n', ' '));",
    "    }",
    "}",
  );
  return lines.join("\n") + "\n";
}

// ---- approvals-run.apex: submit one gated record per approval probe ----

function approvalRunApex(): string {
  const lines: string[] = [
    "// Generated by generate-ctx.ts — approval-process runtime probes.",
    "// One record per probe, then Approval.process(); the outcome is reported as",
    "//   APPRV64|<base64 of id|outcome|instanceStatus|workitems|message>",
    "// Base64 because the debug channel entity-encodes pipes and quotes, which",
    "// would corrupt the delimiter and the org's own error text.",
  ];
  for (const o of new Set(manifest.approvalRuntimeProbes.map((p) => p.object))) {
    // Records locked by a pending approval refuse to delete; leftovers are
    // harmless because every verdict comes from this run's own submit result.
    lines.push(`Database.delete([SELECT Id FROM ${o} LIMIT 10000], false);`);
  }
  for (const p of manifest.approvalRuntimeProbes) {
    const ctor = p.gate ? `Gate__c = '${p.gate}'` : "";
    lines.push(
      "{",
      `    String pid = '${p.id}';`,
      "    try {",
      `        ${p.object} r = new ${p.object}(${ctor});`,
      "        insert r;",
      "        try {",
      "            Approval.ProcessSubmitRequest rq = new Approval.ProcessSubmitRequest();",
      "            rq.setObjectId(r.Id);",
      "            Approval.ProcessResult pr = Approval.process(rq, false);",
      "            String em = '';",
      "            if (pr.getErrors() != null) {",
      "                for (Database.Error er : pr.getErrors()) {",
      "                    em += er.getStatusCode() + ': ' + er.getMessage() + ' ;; ';",
      "                }",
      "            }",
      "            List<Id> wis = pr.getNewWorkitemIds();",
      "            String pay = pid + '|' + (pr.isSuccess() ? 'SUBMITTED' : 'REFUSED') + '|'",
      "                + pr.getInstanceStatus() + '|' + (wis == null ? -1 : wis.size()) + '|' + em;",
      "            System.debug('APPRV64|' + EncodingUtil.base64Encode(Blob.valueOf(pay.left(600))));",
      "        } catch (Exception ex) {",
      "            String pay = pid + '|EXCEPTION||-1|' + ex.getTypeName() + ': ' + ex.getMessage();",
      "            System.debug('APPRV64|' + EncodingUtil.base64Encode(Blob.valueOf(pay.left(600))));",
      "        }",
      "    } catch (Exception ins) {",
      "        String pay = pid + '|INSERT_FAILED||-1|' + ins.getTypeName() + ': ' + ins.getMessage();",
      "        System.debug('APPRV64|' + EncodingUtil.base64Encode(Blob.valueOf(pay.left(600))));",
      "    }",
      "}",
    );
  }
  return lines.join("\n") + "\n";
}

// ---- write ----

const plan: CtxPlan = {
  components,
  shells,
  batches,
  untestable,
  runtimeProbes: manifest.runtimeProbes,
  flowValueProbes: manifest.flowValueProbes,
  fieldUpdateProbes: manifest.fieldUpdateProbes,
  approvalProbes: manifest.approvalRuntimeProbes,
  runtimeObjects: {
    FxRt__c: ["Gate__c", "BlankN__c", "BlankT__c"],
    FxWfu__c: ["Gate__c", "BlankN__c", "BlankT__c", "TgtText__c", "TgtNum__c"],
    FxErr1__c: [],
    FxErr2__c: [],
    FxErr3__c: [],
    FxErr4__c: [],
    ...Object.fromEntries(
      approvalObjects.map((o) => [o, APPROVAL_FIELD_DEFS.map(([f]) => f)]),
    ),
  },
};
writeFileSync(join(ROOT, "ctx-plan.json"), JSON.stringify(plan, null, 1));
writeFileSync(join(ROOT, "data-ctx.apex"), apexLines());
writeFileSync(join(ROOT, "flows-run.apex"), flowRunApex());
writeFileSync(join(ROOT, "wfu-run.apex"), wfuRunApex());
writeFileSync(join(ROOT, "approvals-run.apex"), approvalRunApex());

const byKind = new Map<string, number>();
for (const c of components) {
  byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
}
console.log(
  `generated ctx-plan.json: ${components.length} components (` +
    [...byKind].map(([k, n]) => `${k}:${n}`).join(", ") +
    `), ${batches.length} batches, ${untestable.length} untestable probes`,
);
for (const u of untestable) {
  console.log(`  UNTESTABLE ${u.container} ${u.name}: ${u.reason}`);
}
