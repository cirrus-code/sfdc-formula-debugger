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

// Escape hatch for org rows whose rendering rule is not pinned down yet:
// quarantined rows count toward neither pass nor fail. Currently empty — the
// wave-4 `^` bisect settled every previously quarantined row.
const NUMERIC_RENDERING_QUARANTINE = new Set<string>([]);

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
