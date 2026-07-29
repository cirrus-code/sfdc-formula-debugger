import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTEXTS } from "./contexts.ts";
import { FUNCTIONS } from "./functions.ts";

/**
 * Registry availability vs the org-verified per-context matrix
 * (corpus/org-availability.json, produced by orgcheck's per-context pass): every
 * conclusive org verdict must agree with the registry's `contexts` data and
 * each context's declared globals.
 *
 * Only conclusive verdicts bind: rows whose container failed its canaries,
 * whose rejection could belong to a helper (taint), or whose construct was
 * inexpressible in that container are recorded as inconclusive and skipped
 * here — the registry stays best-effort for those (rule 1: no guessing, in
 * either direction).
 */

interface AvailabilityRow {
  context: string;
  kind: "function" | "global";
  name: string;
  outcome: string;
  verdict: "available" | "unavailable" | "inconclusive";
  problem?: string;
}

const rows: AvailabilityRow[] = JSON.parse(
  readFileSync("corpus/org-availability.json", "utf8"),
);

const fnByName = new Map(FUNCTIONS.map((f) => [f.name, f]));
const ctxById = new Map(CONTEXTS.map((c) => [c.id, c]));

describe("registry availability vs org-verified matrix", () => {
  it("covers every context id", () => {
    const probed = new Set(rows.map((r) => r.context));
    for (const ctx of CONTEXTS) {
      expect(probed, `no availability rows for context ${ctx.id}`).toContain(
        ctx.id,
      );
    }
  });

  it("function contexts agree with every conclusive org verdict", () => {
    const disagreements: string[] = [];
    for (const r of rows) {
      if (r.kind !== "function" || r.verdict === "inconclusive") {
        continue;
      }
      const fn = fnByName.get(r.name);
      if (!fn || !ctxById.has(r.context)) {
        continue;
      }
      const registryAllows =
        fn.contexts === "all" || fn.contexts.includes(r.context);
      const orgAllows = r.verdict === "available";
      if (registryAllows !== orgAllows) {
        disagreements.push(
          `${r.name} in ${r.context}: registry=${registryAllows ? "allowed" : "excluded"}, org=${r.verdict}`,
        );
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("context globals agree with every conclusive org verdict", () => {
    const disagreements: string[] = [];
    for (const r of rows) {
      if (r.kind !== "global" || r.verdict === "inconclusive") {
        continue;
      }
      const ctx = ctxById.get(r.context);
      if (!ctx) {
        continue;
      }
      const registryAllows = ctx.globals.some((g) => g.name === r.name);
      const orgAllows = r.verdict === "available";
      if (registryAllows !== orgAllows) {
        disagreements.push(
          `global ${r.name} in ${r.context}: registry=${registryAllows ? "declared" : "absent"}, org=${r.verdict}`,
        );
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("reports the availability conformance number", () => {
    const conclusive = rows.filter((r) => r.verdict !== "inconclusive").length;
    console.log(
      `Org availability matrix: ${conclusive}/${rows.length} rows conclusive across ` +
        `${new Set(rows.map((r) => r.context)).size} contexts`,
    );
    expect(conclusive).toBeGreaterThan(0);
  });
});
