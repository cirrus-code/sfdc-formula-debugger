// Turn a collect-ctx results file into the per-context availability corpus
// (../corpus/org-availability.json) and print a drift report against the
// registry's current `contexts` data.
//
//   pnpm emit-ctx -- results/ctx-run-<date>.json
//
// Conclusiveness rules (rule 1 applied to the harness):
//   - a container is trusted only if its canaries behaved (ok deployed, bogus
//     rejected);
//   - an ACCEPTED probe in a trusted container is conclusive (the compiler saw
//     the construct and took it);
//   - a REJECTED probe is conclusive only if the message names the probed
//     construct, or the probe carries no taint — otherwise the rejection may
//     belong to a helper (literal DATE(), an IF wrapper, $ObjectType) and is
//     flagged for human triage instead of being encoded.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONTEXTS } from "../../src/registry/contexts.ts";
import { FUNCTIONS } from "../../src/registry/functions.ts";
import type { CtxResults } from "./shared-ctx.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const resultsPath = process.argv.slice(2).find((a) => a !== "--");
if (!resultsPath) {
  console.error("usage: pnpm emit-ctx -- results/ctx-run-<date>.json");
  process.exit(1);
}
const results: CtxResults = JSON.parse(
  readFileSync(join(ROOT, resultsPath), "utf8"),
);
const source = `org:${results.org.id}:${results.collectedAt.slice(0, 10)}`;

const trusted = new Map(
  results.containerStatus.map((s) => [s.container, s.verifiable]),
);

interface AvailabilityRow {
  source: string;
  context: string;
  kind: "function" | "global";
  name: string;
  formula: string;
  outcome: "accepted" | "rejected" | "skipped" | "untestable";
  /** The availability conclusion, separated from the raw deploy outcome: a
   * signature complaint is a REJECTION that proves the function exists. */
  verdict: "available" | "unavailable" | "inconclusive";
  problem?: string;
  taint?: readonly string[];
  reason?: string;
}

/** Classify a rejection message. The org's own phrasing distinguishes
 * resolution failures from signature complaints:
 *   "Unknown function X. Check spelling."            → not available
 *   "Function X may not be used in this type of…"    → not available (exists elsewhere)
 *   "Incorrect parameter type for function 'X()'…"   → available (compiler resolved it)
 *   "Incorrect number of parameters for function…"   → available (ill-shaped probe; fix it)
 *   "Field $X… does not exist"                       → global not available (or bad member)
 */
function classifyRejection(
  name: string,
  problem: string | undefined,
  taint: readonly string[] | undefined,
): "available" | "unavailable" | "inconclusive" {
  if (!problem) {
    return "inconclusive";
  }
  if (/Incorrect (parameter type|number of parameters) for function/i.test(problem)) {
    return "available";
  }
  const bare = name.replace(/^\$/, "").toUpperCase();
  const p = problem.toUpperCase();
  if (
    p.includes(`UNKNOWN FUNCTION ${bare}`) ||
    (p.includes(`FUNCTION ${bare}`) && p.includes("MAY NOT BE USED")) ||
    (name.startsWith("$") && p.includes(name.toUpperCase()) && p.includes("DOES NOT EXIST"))
  ) {
    return "unavailable";
  }
  // Rejection that names neither pattern: only conclusive when nothing else in
  // the formula (no taint) could have caused it AND the message is about the
  // formula at all — container-shape complaints (e.g. Active flows demanding a
  // variable <scale>) must not read as availability verdicts.
  const formulaRelated = /function|formula|does not exist/i.test(problem);
  return formulaRelated && (taint ?? []).length === 0
    ? "unavailable"
    : "inconclusive";
}

const rows: AvailabilityRow[] = [];

for (const p of results.probes) {
  if (p.kind !== "function" && p.kind !== "global") {
    continue;
  }
  const containerTrusted = trusted.get(p.container!) ?? false;
  let verdict: AvailabilityRow["verdict"] = "inconclusive";
  if (containerTrusted && p.outcome === "accepted") {
    verdict = "available";
  } else if (containerTrusted && p.outcome === "rejected") {
    verdict = classifyRejection(p.name!, p.problem, p.taint);
  }
  rows.push({
    source,
    context: p.container!,
    kind: p.kind,
    name: p.name!,
    formula: p.formula ?? "",
    outcome: p.outcome,
    verdict,
    problem: p.problem,
    taint: p.taint && p.taint.length > 0 ? p.taint : undefined,
    reason: p.skipReason,
  });
}
for (const u of results.untestable) {
  rows.push({
    source,
    context: u.container,
    kind: u.kind,
    name: u.name,
    formula: "",
    outcome: "untestable",
    verdict: "inconclusive",
    reason: u.reason,
  });
}

const outPath = join(ROOT, "..", "corpus", "org-availability.json");
writeFileSync(outPath, JSON.stringify(rows, null, 1));

// ---- summary ----

const byContext = new Map<string, AvailabilityRow[]>();
for (const r of rows) {
  const list = byContext.get(r.context) ?? [];
  list.push(r);
  byContext.set(r.context, list);
}
console.log(`wrote ${rows.length} availability rows to ${outPath}\n`);
for (const [ctx, list] of byContext) {
  const v = (x: string) => list.filter((r) => r.verdict === x).length;
  const n = (o: string) => list.filter((r) => r.outcome === o).length;
  console.log(
    `${trusted.get(ctx as never) ? "✅" : "⛔"} ${ctx}: ${v("available")} available · ${v(
      "unavailable",
    )} unavailable · ${v("inconclusive")} inconclusive (${n("skipped")} skipped, ${n("untestable")} untestable)`,
  );
}

// ---- drift vs the registry ----

console.log("\n--- registry drift (conclusive verdicts only) ---");
let drift = 0;
for (const fn of FUNCTIONS) {
  for (const r of rows) {
    if (r.kind !== "function" || r.name !== fn.name || r.verdict === "inconclusive") {
      continue;
    }
    const registryAllows =
      fn.contexts === "all" || fn.contexts.includes(r.context);
    const orgAllows = r.verdict === "available";
    if (registryAllows !== orgAllows) {
      drift++;
      console.log(
        `DRIFT ${fn.name} in ${r.context}: registry=${registryAllows ? "allowed" : "excluded"} org=${r.verdict}${
          r.problem ? ` (${r.problem.slice(0, 100)})` : ""
        }`,
      );
    }
  }
}
for (const ctx of CONTEXTS) {
  const declared = new Set(ctx.globals.map((g) => g.name));
  for (const r of rows) {
    if (r.kind !== "global" || r.context !== ctx.id || r.verdict === "inconclusive") {
      continue;
    }
    const registryAllows = declared.has(r.name);
    const orgAllows = r.verdict === "available";
    if (registryAllows !== orgAllows) {
      drift++;
      console.log(
        `DRIFT global ${r.name} in ${ctx.id}: registry=${registryAllows ? "declared" : "absent"} org=${r.verdict}`,
      );
    }
  }
}
console.log(drift === 0 ? "(none)" : `${drift} drift findings`);

// ---- runtime verdicts ----

if (results.runtime.length > 0) {
  console.log("\n--- runtime probes ---");
  for (const rt of results.runtime) {
    console.log(
      `${rt.id}: ${rt.outcome}${rt.message ? ` — ${rt.message.slice(0, 160)}` : ""}`,
    );
  }
}
