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

// The `^` operator's overflow boundary is genuinely open: 10^60 computes,
// 10^80 is a runtime error, yet (10^60)*(10^60) = 10^120 computes — the cap
// is ^-specific (exponent- or result-based, undetermined) and NOT a value-
// domain overflow. Quarantined pending a wave-4 bisect; our evaluator
// currently computes large powers rather than guessing a boundary.
const NUMERIC_RENDERING_QUARANTINE = new Set<string>([
  "semantics:overflow_pow_isblank#0",
  "semantics:overflow_pow_text#0",
  "semantics:overflow_pow_edge#0",
  "semantics:overflow_b80#0",
  "semantics:overflow_b90#0",
  "semantics:overflow_b98#0",
  "semantics:overflow_b99#0",
  "semantics:overflow_b100#0",
  "semantics:overflow_b110#0",
]);

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
