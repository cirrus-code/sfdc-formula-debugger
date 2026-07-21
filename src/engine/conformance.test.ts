import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "./corpus.ts";
import { runRow, type RowStatus } from "./conformance.ts";

/**
 * Conformance run against Salesforce's own oracle corpus (CONFORMANCE.md, WS2/WS5).
 * The conformance number = pass / (pass + fail) over the comparable subset. It is
 * the durable marketing metric — this test protects it with a locked baseline
 * that should only ever move up.
 */

// Locked baseline: raise as the evaluator improves, never lower silently. Rules
// verified via the WS3 JVM oracle (oracle/) lifted this from 0.74 → 0.86; the
// remaining gap (date rendering, FLOOR/CEIL+ROUND nuances) is in VERIFICATION.md.
const BASELINE = 0.85;

const rows: CorpusRow[] = JSON.parse(readFileSync("corpus/salesforce-v2.json", "utf8"));

describe("conformance: Salesforce formula-engine corpus", () => {
  const tally: Record<RowStatus, number> = { pass: 0, fail: 0, quarantine: 0, unsupported: 0 };
  const failures: string[] = [];

  for (const row of rows) {
    const outcome = runRow(row);
    tally[outcome.status] += 1;
    if (outcome.status === "fail" && failures.length < 25) {
      failures.push(`${row.name} [${row.blankMode}] ${row.formula} => expected ${row.expected}, got ${outcome.got}`);
    }
  }

  const comparable = tally.pass + tally.fail;
  const conformance = comparable ? tally.pass / comparable : 0;

  if (process.env.CONF_DUMP) {
    writeFileSync(process.env.CONF_DUMP, JSON.stringify({ tally, conformance, failures }, null, 2));
  }

  it("reports the conformance number", () => {
    console.log(
      `\nConformance: ${(conformance * 100).toFixed(1)}% (${tally.pass}/${comparable} comparable)\n` +
        `  pass ${tally.pass} · fail ${tally.fail} · quarantine ${tally.quarantine} · unsupported ${tally.unsupported} · total ${rows.length}\n` +
        (failures.length ? `  sample failures:\n   - ${failures.slice(0, 10).join("\n   - ")}\n` : ""),
    );
    expect(rows.length).toBeGreaterThan(1000);
    expect(comparable).toBeGreaterThan(200);
  });

  it("meets the locked conformance baseline", () => {
    expect(conformance).toBeGreaterThanOrEqual(BASELINE);
  });
});
