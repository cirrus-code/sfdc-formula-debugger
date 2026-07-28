// Turn a collect.ts results file into org-tier golden corpus rows
// (../corpus/org-verified.json) and print an oracle-vs-org drift report.
//
//   pnpm emit -- results/org-run-<date>.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { returnToDataType, type ProbeReturn } from "./shared.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const resultsPath = process.argv.slice(2).find((a) => a !== "--");
if (!resultsPath) {
  console.error("usage: pnpm emit -- results/org-run-<date>.json");
  process.exit(1);
}
const results = JSON.parse(readFileSync(join(ROOT, resultsPath), "utf8"));
const source = `org:${results.org.id}:${results.collectedAt.slice(0, 10)}`;

interface ResultRow {
  recordKey: string;
  fields: { name: string; type: string; value: string | null }[];
  oracleExpected?: string;
  value: string | null;
  text: string | null;
}

function unalias(
  name: string,
  aliases: Record<string, string> | undefined,
): string {
  return aliases?.[name.toLowerCase()] ?? name;
}

function unaliasFormula(
  formula: string,
  aliases: Record<string, string> | undefined,
): string {
  let out = formula;
  for (const [alias, original] of Object.entries(aliases ?? {})) {
    out = out.replace(new RegExp(`\\b${alias}\\b`, "gi"), original);
  }
  return out;
}

/** The org-observed expected value, preferring the exact TEXT() twin channel
 * for numerics/dates (SOQL JSON numbers lose precision and rendering). */
function expectedFor(returns: ProbeReturn, row: ResultRow): string {
  const numericOrTemporal: ProbeReturn[] = [
    "Number",
    "Currency",
    "Percent",
    "Date",
    "Datetime",
    "Time",
  ];
  const v =
    numericOrTemporal.includes(returns) && row.text !== null
      ? row.text
      : row.value;
  return v === null ? "null" : v;
}

const corpusRows: unknown[] = [];
let match = 0;
let mismatch = 0;
let incomparable = 0;

for (const p of results.probes) {
  if (!p.deployed) {
    continue;
  }
  // Env-specific observations (session ids…) prove save/evaluate outcomes but
  // must never land in the committed corpus.
  if (p.envSpecific) {
    continue;
  }
  for (const [i, row] of (p.rows as ResultRow[]).entries()) {
    const expected = expectedFor(p.returns, row);
    corpusRows.push({
      source,
      name: `${p.probeId}#${i}`,
      formula: unaliasFormula(p.formula, p.fieldAliases),
      dataType: returnToDataType(p.returns),
      fields: row.fields.map((f) => ({
        name: unalias(f.name, p.fieldAliases),
        type: f.type === "TextArea" || f.type === "Picklist" ? "Text" : f.type,
        value: f.value,
      })),
      blankMode: p.blankMode,
      expected,
    });

    // Drift vs the JVM oracle, best-effort normalization: exact renderings
    // differ (Java toString vs org TEXT()), so only clear verdicts count.
    if (row.oracleExpected === undefined) {
      continue;
    }
    const oracle = row.oracleExpected;
    const org = expected;
    const bothNull = oracle === "null" && org === "null";
    const asNum = (s: string) =>
      /^-?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
    if (bothNull || oracle === org) {
      match++;
    } else if (Number.isFinite(asNum(oracle)) && Number.isFinite(asNum(org))) {
      if (Math.abs(asNum(oracle) - asNum(org)) < 1e-9) {
        match++;
      } else {
        mismatch++;
        console.log(
          `DRIFT ${p.probeId}#${i} [${p.blankMode}]: oracle=${oracle} org=${org}`,
        );
      }
    } else if (
      oracle.startsWith("Error:") ||
      oracle.includes("GMT") ||
      org.includes("-")
    ) {
      incomparable++;
    } else {
      mismatch++;
      console.log(
        `DRIFT ${p.probeId}#${i} [${p.blankMode}]: oracle=${JSON.stringify(oracle)} org=${JSON.stringify(org)}`,
      );
    }
  }
}

const outPath = join(ROOT, "..", "corpus", "org-verified.json");
writeFileSync(outPath, JSON.stringify(corpusRows, null, 1));
console.log(
  `\nwrote ${corpusRows.length} org-verified rows to ${outPath}\n` +
    `oracle drift: ${match} match · ${mismatch} mismatch · ${incomparable} incomparable (renderings differ)`,
);
