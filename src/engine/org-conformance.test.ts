import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "./corpus.ts";
import { runRow, type RowStatus } from "./conformance.ts";

/**
 * Conformance run against the org-verified corpus tier (orgcheck/), the top of
 * the trust order: rows read back from a real Salesforce org
 * (VERIFICATION.md, org-pass section). Where this tier and the oracle corpus
 * disagree, these rows win — a failure here is a semantics bug, full stop.
 *
 * The readback channel (SOQL) collapses blank, empty text, and `#Error!` into
 * null, so rows expecting "null" run with `nullIsChannelAmbiguous`.
 */

// Locked baseline: every org row passes or is explicitly quarantined. A new
// org run that adds failing rows must be triaged, never absorbed by lowering
// this.
const BASELINE = 1;

const rows: CorpusRow[] = JSON.parse(
  readFileSync("corpus/org-verified.json", "utf8"),
);

/**
 * The product TEXT() number-rendering rule is now pinned down and implemented
 * (renderProductNumber in builtins.ts: Oracle-NUMBER-parity digit budget, no
 * leading zero, plain notation — settled by the 2026-07-28 text_* probe
 * batch), which resolved the former TEXT quarantine cluster. Only the Percent
 * interaction remains open: TEXT of a Percent field couples the ×100 result
 * convention with the display scale in a way one probe cannot decide.
 * Quarantined — not compared either way — until a dedicated probe batch pins
 * it; do NOT silently match one tier by breaking the other.
 */
const NUMERIC_RENDERING_QUARANTINE = new Set(["semantics:text_percent_field#0"]);

describe("conformance: org-verified corpus (real-org tier)", () => {
  const tally: Record<RowStatus, number> = {
    pass: 0,
    fail: 0,
    quarantine: 0,
    unsupported: 0,
  };
  const failures: Array<CorpusRow & { got: string }> = [];

  for (const row of rows) {
    if (NUMERIC_RENDERING_QUARANTINE.has(row.name)) {
      tally.quarantine += 1;
      continue;
    }
    const outcome = runRow(row, { nullIsChannelAmbiguous: true });
    tally[outcome.status] += 1;
    if (outcome.status === "fail") {
      failures.push({ ...row, got: outcome.got ?? "" });
    }
  }
  const failureLines = failures.map(
    (f) =>
      `${f.name} [${f.blankMode}] ${f.formula} => expected ${f.expected}, got ${f.got}`,
  );

  const comparable = tally.pass + tally.fail;
  const conformance = comparable ? tally.pass / comparable : 0;

  it("reports the org conformance number", () => {
    console.log(
      `\nOrg conformance: ${(conformance * 100).toFixed(1)}% (${tally.pass}/${comparable} comparable)\n` +
        `  pass ${tally.pass} · fail ${tally.fail} · quarantine ${tally.quarantine} · unsupported ${tally.unsupported} · total ${rows.length}\n` +
        (failureLines.length
          ? `  failures:\n   - ${failureLines.slice(0, 20).join("\n   - ")}\n`
          : ""),
    );
    expect(rows.length).toBeGreaterThan(400);
    expect(comparable).toBeGreaterThan(150);
  });

  it("meets the locked org-conformance baseline", () => {
    expect(conformance).toBeGreaterThanOrEqual(BASELINE);
  });
});
