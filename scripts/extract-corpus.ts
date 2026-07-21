/**
 * WS2 corpus extractor (CONFORMANCE.md). Reads Salesforce's vendored
 * `formulaTestV2.xml` oracle and emits our golden corpus JSON.
 *
 * One testData row yields two corpus rows — one per blank mode — taken from the
 * Java execution paths `formula` (blank-as-zero) and `formulaNullAsNull`
 * (blank-as-blank), which are the faithful oracle (the JS path mis-handles
 * division by zero; see CONFORMANCE.md).
 *
 * Run: `node scripts/extract-corpus.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { sfDataTypeToType, type CorpusRow } from "../src/engine/corpus.ts";

const SOURCE = "corpus/sources/formulaTestV2.xml";
const OUT = "corpus/salesforce-v2.json";
const PROVENANCE = "salesforce/formula-engine formulaTestV2.xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    name === "testcase" || name === "referenceField" || name === "testData",
});

interface RawTestcase {
  "@_testName": string;
  "@_dataType": string;
  "@_formula": string;
  "@_executionPaths": string;
  referenceField?: Array<{ "@_fieldName": string; "@_dataType": string }>;
  testData?: Array<{ "@_input"?: string; "@_expectedOutput": string }>;
}

/** Decode XML entities the parser leaves encoded (notably numeric refs like &#34;). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function splitValues(raw: string): string[] {
  return raw.split(",").map((v) => decodeEntities(v.trim()));
}

const xml = readFileSync(SOURCE, "utf8");
const doc = parser.parse(xml);
const testcases: RawTestcase[] = doc["formula-test"].testcase ?? [];

const rows: CorpusRow[] = [];
const stats = {
  testcases: testcases.length,
  dataRows: 0,
  emitted: 0,
  skippedShape: 0,
};

for (const tc of testcases) {
  const paths = tc["@_executionPaths"].split(",").map((p) => p.trim());
  const zeroIdx = paths.indexOf("formula");
  const blankIdx = paths.indexOf("formulaNullAsNull");
  const refFields = tc.referenceField ?? [];

  for (const td of tc.testData ?? []) {
    stats.dataRows += 1;
    const expected = splitValues(td["@_expectedOutput"]);
    if (expected.length !== paths.length) {
      stats.skippedShape += 1;
      continue;
    }
    const inputs =
      td["@_input"] !== undefined ? splitValues(td["@_input"]) : [];
    if (refFields.length > 0 && inputs.length !== refFields.length) {
      stats.skippedShape += 1;
      continue;
    }

    const fields = refFields.map((rf, i) => ({
      name: `${rf["@_fieldName"]}__c`,
      type: sfDataTypeToType(rf["@_dataType"]),
      value: inputs[i] ?? null,
    }));

    for (const [blankMode, idx] of [
      ["zero", zeroIdx],
      ["blank", blankIdx],
    ] as const) {
      if (idx < 0) {
        continue;
      }
      rows.push({
        source: PROVENANCE,
        name: tc["@_testName"],
        formula: decodeEntities(tc["@_formula"]),
        dataType: tc["@_dataType"],
        fields,
        blankMode,
        expected: expected[idx]!,
      });
      stats.emitted += 1;
    }
  }
}

writeFileSync(OUT, `${JSON.stringify(rows, null, 0)}\n`);
process.stdout.write(
  `Extracted ${stats.emitted} rows from ${stats.testcases} testcases ` +
    `(${stats.dataRows} data rows, ${stats.skippedShape} skipped on shape) -> ${OUT}\n`,
);
