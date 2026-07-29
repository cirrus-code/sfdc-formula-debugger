import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "./corpus.ts";
import { runRow, type RowStatus } from "./conformance.ts";

/**
 * Conformance run against Salesforce's own oracle corpus (CONFORMANCE.md, WS2/WS5).
 * The conformance number = pass / (pass + fail) over the comparable subset. It is
 * the headline metric — this test protects it with a locked baseline
 * that should only ever move up.
 */

// Locked baseline: raise as the evaluator improves, never lower silently. The
// gap to 100% is the triaged discrepancy backlog in VERIFICATION.md.
const BASELINE = 0.999;

const rows: CorpusRow[] = JSON.parse(
  readFileSync("corpus/salesforce-v2.json", "utf8"),
);

/**
 * Row identity. This corpus repeats a test name once per field combo × blank
 * mode, so a row is `name#<occurrence index in file order>`. The org corpus
 * names the same tests `corpus:<name>#<combo>`, one index per field combo with
 * both blank modes sharing it. The two combo lists are not always the same
 * length (testExponentiationOperator has 21 combos org-side against 22 here),
 * so the exclusions below pair the tiers by field values, not by index
 * arithmetic: each `corpus:` index cited is the org row carrying the same
 * inputs as the oracle row it overrules.
 */
function rowKey(row: CorpusRow, seen: Map<string, number>): string {
  const n = seen.get(row.name) ?? 0;
  seen.set(row.name, n + 1);
  return `${row.name}#${n}`;
}

/**
 * Rows this oracle loses. corpus/org-verified.json is read back from a real
 * org and sits above the oracle in the trust order (CONFORMANCE.md), so where
 * the two tiers answer the same construct differently the org wins and
 * matching the oracle would be the bug. These rows are excluded from pass/fail
 * and tallied separately — never silently dropped — and each is held to the
 * org row that overrules it:
 *
 *  - testSimpleSubstitute#6/#7 and #14/#15: SUBSTITUTE with a blank search
 *    term is a no-op, not null (corpus:testSimpleSubstitute#3 reads back
 *    "Salesforce", #7 reads back "Golden File").
 *  - testSimpleSubstitute#16/#17: the same no-op rule
 *    (corpus:testSimpleSubstitute#8 reads back "Replace Space"). The oracle's
 *    "ReplaceNoSpace" answers a different input than the row encodes: the XML
 *    search term is a literal space (formulaTestV2.xml:14248) that the
 *    extractor's per-value trim() turned into a blank.
 *  - testIfTextCompareGreaterThan#16/#17 and testIfTextCompareLessEqual#16/#17:
 *    "Left" vs "Left". The oracle's answers make text ordering irreflexive;
 *    the org's do not (corpus:testIfTextCompareGreaterThan#8 is false,
 *    corpus:testIfTextCompareLessEqual#8 is true).
 *  - testExponentiationOperator#10/#11 (99^-1) and #38/#39 (1.00596^240): the
 *    org renders a field-valued `^` at full decimal scale where the oracle
 *    stops at double-ish 19/18 significant digits
 *    (corpus:testExponentiationOperator#5 runs to 40 decimal places, #18 to
 *    4.16265990153128261843019338536618499848 — the evidence the evaluator's
 *    runtime `^` branch is built on).
 */
const ORG_OVERRULED = new Set<string>([
  "testSimpleSubstitute#6",
  "testSimpleSubstitute#7",
  "testSimpleSubstitute#14",
  "testSimpleSubstitute#15",
  "testSimpleSubstitute#16",
  "testSimpleSubstitute#17",
  "testIfTextCompareGreaterThan#16",
  "testIfTextCompareGreaterThan#17",
  "testIfTextCompareLessEqual#16",
  "testIfTextCompareLessEqual#17",
  "testExponentiationOperator#10",
  "testExponentiationOperator#11",
  "testExponentiationOperator#38",
  "testExponentiationOperator#39",
  // Empty text IS blank in the product's value domain (pw8_be_* riders:
  // "" & "", TRIM(" "), UPPER(""), SUBSTITUTE deleting everything — all
  // read blank through ISBLANK). The oracle's "" expectations below encode
  // a distinction the org cannot even represent.
  "testUpper#0",
  "testUpper#1",
  "testLower#0",
  "testLower#1",
  "testInitCap#0",
  "testInitCap#1",
  "testUpperLocale#0",
  "testUpperLocale#1",
  "testUpperLocale#22",
  "testUpperLocale#23",
  "testUpperLocale#44",
  "testUpperLocale#45",
  "testLowerLocale#0",
  "testLowerLocale#1",
  "testLowerLocale#22",
  "testLowerLocale#23",
  "testLowerLocale#44",
  "testLowerLocale#45",
]);

/**
 * Rows whose expected value did not survive the vendored channel, leaving
 * nothing to compare against — the same "incomparable, so neither pass nor
 * fail" treatment the comparator applies to Java-rendered temporals.
 *
 * CHR(9), CHR(13) and CHR(32) each carry a single space as their expectation
 * in formulaTestV2.xml (XML attribute-value normalization folds tab and CR to
 * a space, so all three rows are byte-identical), which the extractor's
 * per-value trim() then empties. The org twin cannot arbitrate either:
 * whitespace-only text is trimmed away at save, so corpus:testChr#2/#3/#4 all
 * read back null.
 */
const EXPECTATION_QUARANTINE = new Set<string>([
  "testChr#4",
  "testChr#5",
  "testChr#6",
  "testChr#7",
  "testChr#8",
  "testChr#9",
]);

describe("conformance: Salesforce formula-engine corpus", () => {
  const tally: Record<RowStatus, number> = {
    pass: 0,
    fail: 0,
    quarantine: 0,
    unsupported: 0,
  };
  let orgOverruled = 0;
  const failures: Array<CorpusRow & { key: string; got: string }> = [];

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row, seen);
    if (ORG_OVERRULED.has(key)) {
      orgOverruled += 1;
      continue;
    }
    if (EXPECTATION_QUARANTINE.has(key)) {
      tally.quarantine += 1;
      continue;
    }
    const outcome = runRow(row);
    tally[outcome.status] += 1;
    if (outcome.status === "fail") {
      failures.push({ ...row, key, got: outcome.got ?? "" });
    }
  }
  const failureLines = failures.map(
    (f) =>
      `${f.key} [${f.blankMode}] ${f.formula} => expected ${f.expected}, got ${f.got}`,
  );

  const comparable = tally.pass + tally.fail;
  const conformance = comparable ? tally.pass / comparable : 0;

  if (process.env.CONF_DUMP) {
    writeFileSync(
      process.env.CONF_DUMP,
      JSON.stringify({ tally, conformance, failures }, null, 2),
    );
  }

  it("reports the conformance number", () => {
    console.log(
      `\nConformance: ${(conformance * 100).toFixed(1)}% (${tally.pass}/${comparable} comparable)\n` +
        `  pass ${tally.pass} · fail ${tally.fail} · quarantine ${tally.quarantine} · unsupported ${tally.unsupported} · org-overruled ${orgOverruled} · total ${rows.length}\n` +
        (failureLines.length
          ? `  sample failures:\n   - ${failureLines.slice(0, 10).join("\n   - ")}\n`
          : ""),
    );
    expect(rows.length).toBeGreaterThan(1000);
    expect(comparable).toBeGreaterThan(200);
  });

  it("meets the locked conformance baseline", () => {
    expect(conformance).toBeGreaterThanOrEqual(BASELINE);
  });

  it("excludes only rows an org-tier row contradicts", () => {
    // Guards the allowlist against drift: every excluded key must still name a
    // row in this corpus, so a corpus regeneration that renumbers or drops a
    // row fails here instead of quietly widening the exclusion.
    const keys = new Set<string>();
    const counter = new Map<string, number>();
    for (const row of rows) {
      keys.add(rowKey(row, counter));
    }
    for (const key of [...ORG_OVERRULED, ...EXPECTATION_QUARANTINE]) {
      expect(keys.has(key), `${key} is no longer a corpus row`).toBe(true);
    }
    expect(orgOverruled).toBe(ORG_OVERRULED.size);
  });
});
