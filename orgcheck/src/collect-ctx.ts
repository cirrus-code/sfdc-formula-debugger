// Run the wave-2 per-context pass: deploy each batch from ctx-plan.json
// (per-component rejections are verdicts, per wave 1's rounds pattern), gate
// each container's matrix on its canaries, run the DML-triggered runtime
// probes, and write a joined results file for emit-ctx.
//
//   pnpm collect-ctx -- --org <alias> [--skip-runtime] [--only <batchPrefix>]

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { childSortKey } from "./shared-ctx.ts";
import type {
  CtxComponent,
  CtxContainerStatus,
  CtxFlowValueResult,
  CtxPlan,
  CtxProbeResult,
  CtxResults,
  CtxRuntimeResult,
} from "./shared-ctx.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const SF = join(ROOT, "node_modules", ".bin", "sf");

const args = process.argv.slice(2);
const composeFlag = args.indexOf("--compose-only");
const composeOnly = composeFlag === -1 ? null : args[composeFlag + 1];
const orgFlag = args.indexOf("--org");
if (!composeOnly && (orgFlag === -1 || !args[orgFlag + 1])) {
  console.error(
    "usage: pnpm collect-ctx -- --org <alias> [--skip-runtime] [--only <batchPrefix>]\n" +
      "       pnpm collect-ctx -- --compose-only <batchId>   (write the package, no deploy)",
  );
  process.exit(1);
}
const org = args[orgFlag + 1];
const skipRuntime = args.includes("--skip-runtime");
const onlyFlag = args.indexOf("--only");
const only = onlyFlag === -1 ? null : args[onlyFlag + 1];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sfJson(cmdArgs: string[]): any {
  let stdout: string;
  try {
    stdout = execFileSync(SF, [...cmdArgs, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; message?: string };
    if (typeof err.stdout === "string" && err.stdout.trim().startsWith("{")) {
      stdout = err.stdout;
    } else {
      throw new Error(
        `sf ${cmdArgs.join(" ")} failed: ${err.stderr ?? err.message}`,
        { cause: e },
      );
    }
  }
  return JSON.parse(stdout);
}

const plan: CtxPlan = JSON.parse(
  readFileSync(join(ROOT, "ctx-plan.json"), "utf8"),
);
const byId = new Map(plan.components.map((c) => [c.id, c]));
mkdirSync(join(ROOT, "results"), { recursive: true });

// ---- package composition ----

const PKG_DIR = join(ROOT, "results", "ctx-pkg");

/** Write a metadata-format package containing exactly `components`. Shared
 * files (objects, workflows, labels) are recomposed from the fragments of the
 * included components only, children sorted into schema (alphabetical) order. */
function writePackage(components: CtxComponent[]): void {
  rmSync(PKG_DIR, { recursive: true, force: true });
  mkdirSync(PKG_DIR, { recursive: true });
  const byFile = new Map<string, CtxComponent[]>();
  for (const c of components) {
    const list = byFile.get(c.file) ?? [];
    list.push(c);
    byFile.set(c.file, list);
  }
  for (const [file, comps] of byFile) {
    const full = join(PKG_DIR, file);
    mkdirSync(dirname(full), { recursive: true });
    const standalone = comps.find((c) => c.xml);
    if (standalone) {
      if (comps.length > 1) {
        throw new Error(`standalone file ${file} has multiple components`);
      }
      writeFileSync(full, standalone.xml!);
    } else {
      const shell = plan.shells[file];
      if (!shell) {
        throw new Error(`no shell for shared file ${file}`);
      }
      // The metadata SOAP schema is order-strict and (after fullName)
      // alphabetical. A fragment may carry several top-level elements (the
      // object shell: deploymentStatus + label + nameField + …), so split
      // fragments into their top-level blocks (4-space indent) and sort the
      // blocks globally; sort() is stable, so same-element blocks keep their
      // fragment order.
      const blocks = comps
        .flatMap((c) => c.childXml!.split(/\n(?= {4}<[A-Za-z])/))
        .sort((a, b) => childSortKey(a).localeCompare(childSortKey(b)));
      writeFileSync(full, shell.replace("%CHILDREN%", blocks.join("\n")));
    }
    for (const c of comps) {
      for (const [path, content] of Object.entries(c.extraFiles ?? {})) {
        const p = join(PKG_DIR, path);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content);
      }
    }
  }
  const types = new Map<string, string[]>();
  for (const c of components) {
    const list = types.get(c.mdType) ?? [];
    list.push(c.fullName);
    types.set(c.mdType, list);
  }
  const typesXml = [...types]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([mdType, members]) =>
        `    <types>\n${members
          .sort()
          .map((m) => `        <members>${m}</members>`)
          .join("\n")}\n        <name>${mdType}</name>\n    </types>`,
    )
    .join("\n");
  writeFileSync(
    join(PKG_DIR, "package.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n    <version>62.0</version>\n</Package>\n`,
  );
}

// ---- deploy rounds (wave-1 pattern: the org discards the whole request on
// any component failure, so drop rejections and retry until a round lands) ----

interface DeployOutcome {
  deployed: Set<string>; // component ids
  rejected: Map<string, string>; // component id → problem
}

const asArray = (x: unknown) => {
  if (Array.isArray(x)) {
    return x;
  }
  return x ? [x] : [];
};

function keyOf(c: { componentType?: string; fullName?: string }): string {
  return `${c.componentType}:${c.fullName}`;
}

function deployRounds(label: string, componentIds: string[]): DeployOutcome {
  const out: DeployOutcome = { deployed: new Set(), rejected: new Map() };
  let pending = componentIds.map((id) => byId.get(id)!);
  for (let round = 1; pending.length > 0; round++) {
    if (round > 10) {
      throw new Error(`${label}: still failing after 10 deploy rounds`);
    }
    writePackage(pending);
    console.log(`${label}: round ${round}, ${pending.length} components…`);
    const res = sfJson([
      "project",
      "deploy",
      "start",
      "--metadata-dir",
      PKG_DIR,
      "-o",
      org,
      "--ignore-errors",
      "--wait",
      "60",
    ]);
    const failures = asArray(res.result?.details?.componentFailures).filter(
      (c) => c.fullName !== "package.xml",
    );
    if (failures.length === 0) {
      for (const c of pending) {
        out.deployed.add(c.id);
      }
      console.log(`${label}: ${pending.length} deployed`);
      return out;
    }
    const failedKeys = new Map<string, string>();
    for (const f of failures) {
      failedKeys.set(keyOf(f), f.problem ?? "unknown problem");
    }
    const still: CtxComponent[] = [];
    let matched = 0;
    for (const c of pending) {
      const problem = failedKeys.get(`${c.mdType}:${c.fullName}`);
      if (problem !== undefined) {
        out.rejected.set(c.id, problem);
        matched++;
        console.log(`  rejected: ${c.fullName} — ${problem.slice(0, 160)}`);
      } else {
        still.push(c);
      }
    }
    if (matched === 0) {
      // Failures we can't map to a component (e.g. a file-level parse error)
      // would loop forever — surface them instead.
      throw new Error(
        `${label}: unmatchable deploy failures:\n` +
          failures
            .map((f: { componentType?: string; fullName?: string; problem?: string }) =>
              `  ${f.componentType} ${f.fullName}: ${f.problem}`,
            )
            .join("\n"),
      );
    }
    pending = still;
  }
  return out;
}

if (composeOnly) {
  const batch = plan.batches.find((b) => b.id === composeOnly);
  if (!batch) {
    throw new Error(
      `no batch "${composeOnly}" — batches: ${plan.batches.map((b) => b.id).join(", ")}`,
    );
  }
  writePackage(batch.componentIds.map((id) => byId.get(id)!));
  console.log(`composed ${batch.componentIds.length} components → ${PKG_DIR}`);
  process.exit(0);
}

// ---- run the batches ----

const probeResults: CtxProbeResult[] = [];
const containerStatus: CtxContainerStatus[] = [];

function recordOutcome(
  c: CtxComponent,
  outcome: CtxProbeResult["outcome"],
  problem?: string,
  skipReason?: string,
): void {
  probeResults.push({
    id: c.id,
    kind: c.kind,
    container: c.container,
    name: c.name,
    formula: c.formula,
    taint: c.taint,
    mdType: c.mdType,
    fullName: c.fullName,
    outcome,
    problem,
    skipReason,
  });
}

const gateFailed = new Map<string, string>(); // container → reason

for (const batch of plan.batches) {
  if (only && !batch.id.startsWith(only)) {
    continue;
  }
  if (batch.phase === "matrix") {
    const reason = gateFailed.get(batch.container!);
    if (reason) {
      for (const id of batch.componentIds) {
        recordOutcome(byId.get(id)!, "skipped", undefined, reason);
      }
      console.log(`${batch.id}: SKIPPED — ${reason}`);
      continue;
    }
  }
  const outcome = deployRounds(batch.id, [...batch.componentIds]);
  for (const id of batch.componentIds) {
    const c = byId.get(id)!;
    if (outcome.deployed.has(id)) {
      recordOutcome(c, "accepted");
    } else {
      recordOutcome(c, "rejected", outcome.rejected.get(id));
    }
  }
  if (batch.phase === "support") {
    const rejectedSupport = [...outcome.rejected.entries()];
    if (rejectedSupport.length > 0) {
      console.warn(
        `support: ${rejectedSupport.length} REJECTED support components — dependent probes will misreport:\n` +
          rejectedSupport.map(([id, p]) => `  ${id}: ${p}`).join("\n"),
      );
    }
  }
  if (batch.phase === "canary") {
    const ok = batch.componentIds.find((i) => byId.get(i)!.kind === "canary_ok")!;
    const bogus = batch.componentIds.find(
      (i) => byId.get(i)!.kind === "canary_bogus",
    )!;
    const okDeployed = outcome.deployed.has(ok);
    const bogusRejected = outcome.rejected.has(bogus);
    const verifiable = okDeployed && bogusRejected;
    let detail = "canaries behaved: acceptances and rejections are meaningful";
    if (!okDeployed) {
      detail = `container unusable: ok-canary rejected — ${outcome.rejected.get(ok)}`;
    } else if (!bogusRejected) {
      detail =
        "container does NOT compile-check formulas (bogus function deployed clean) — acceptances are meaningless";
    }
    containerStatus.push({ container: batch.container!, verifiable, detail });
    if (!verifiable) {
      gateFailed.set(batch.container!, detail);
    }
    console.log(`${batch.id}: ${verifiable ? "VERIFIABLE" : "GATE FAILED"} — ${detail}`);
  }
}

// ---- runtime pass: permission set, probe records, debug-channel parse ----

const runtime: CtxRuntimeResult[] = [];

if (!skipRuntime && (!only || only === "runtime")) {
  const runtimeRulesLive = plan.batches
    .find((b) => b.id === "runtime")!
    .componentIds.every((id) =>
      probeResults.some((r) => r.id === id && r.outcome === "accepted"),
    );
  if (!runtimeRulesLive) {
    console.warn(
      "runtime: some runtime rules failed to deploy — probes on those objects will misreport; continuing with the rest",
    );
  }

  // Same FLS lesson as wave 1: API-deployed fields are invisible to the CLI
  // user's anonymous Apex without an explicit grant.
  const PERMSET = "FxCtx_Access";
  const permDir = join(ROOT, "results", "ctx-permset-pkg");
  rmSync(permDir, { recursive: true, force: true });
  mkdirSync(join(permDir, "permissionsets"), { recursive: true });
  const objEntries = Object.entries(plan.runtimeObjects);
  const fieldRows = objEntries.flatMap(([obj, fields]) =>
    fields.map(
      (f) =>
        `    <fieldPermissions>\n        <editable>true</editable>\n        <field>${obj}.${f}</field>\n        <readable>true</readable>\n    </fieldPermissions>`,
    ),
  );
  const objRows = objEntries.map(
    ([obj]) =>
      `    <objectPermissions>\n        <allowCreate>true</allowCreate>\n        <allowDelete>true</allowDelete>\n        <allowEdit>true</allowEdit>\n        <allowRead>true</allowRead>\n        <modifyAllRecords>true</modifyAllRecords>\n        <viewAllRecords>true</viewAllRecords>\n        <object>${obj}</object>\n    </objectPermissions>`,
  );
  writeFileSync(
    join(permDir, "permissionsets", `${PERMSET}.permissionset`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">\n${fieldRows.join("\n")}\n    <label>FxCtx Access</label>\n${objRows.join("\n")}\n</PermissionSet>\n`,
  );
  writeFileSync(
    join(permDir, "package.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <types>\n        <members>${PERMSET}</members>\n        <name>PermissionSet</name>\n    </types>\n    <version>62.0</version>\n</Package>\n`,
  );
  console.log("runtime: granting field access…");
  const permRes = sfJson([
    "project",
    "deploy",
    "start",
    "--metadata-dir",
    permDir,
    "-o",
    org,
    "--wait",
    "20",
  ]);
  if (permRes.result?.status !== "Succeeded") {
    throw new Error(
      `permission set deploy failed: ${JSON.stringify(permRes.result?.details?.componentFailures)}`,
    );
  }
  const assign = sfJson(["org", "permset", "assign", "--name", PERMSET, "-o", org]);
  const assignFailures = (assign.result?.failures ?? []).filter(
    (f: { message?: string }) => !/uplicate/.test(f.message ?? ""),
  );
  if (assignFailures.length > 0) {
    throw new Error(`permset assignment failed: ${JSON.stringify(assignFailures)}`);
  }

  console.log("runtime: inserting probe records…");
  const run = sfJson(["apex", "run", "--file", "data-ctx.apex", "-o", org]);
  if (!run.result?.success) {
    throw new Error(
      `data-ctx.apex failed: ${
        run.result?.compileProblem || run.result?.exceptionMessage || JSON.stringify(run).slice(0, 500)
      }`,
    );
  }
  const rawLogs: string = run.result?.logs ?? "";
  writeFileSync(join(ROOT, "results", "ctx-apex-log.txt"), rawLogs);
  // USER_DEBUG payloads come back HTML-entity-encoded (| as &#124;, & as
  // &amp;, quotes as entities) — decode before matching the channel markers.
  const logs = rawLogs
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const seen = new Map<string, { outcome: "SAVED" | "FIRED" | "ERR"; message?: string }>();
  for (const m of logs.matchAll(/CTXRESULT\|([^|]+)\|(SAVED|ERRRAW)\|?([^\n]*)/g)) {
    const [, id, kind, msg] = m;
    if (kind === "SAVED") {
      seen.set(id, { outcome: "SAVED" });
    } else {
      // A rejection carrying our marker means the rule itself fired; anything
      // else is the runtime surfacing an error of its own.
      seen.set(
        id,
        msg.includes(`RTPROBE:${id}`)
          ? { outcome: "FIRED", message: msg.trim() }
          : { outcome: "ERR", message: msg.trim() },
      );
    }
  }
  for (const rt of plan.runtimeProbes) {
    // A probe whose rule never deployed observed nothing — its record saving
    // trivially must not read as a verdict.
    const ruleDown = probeResults.find(
      (r) => r.id === `runtime:${rt.id}` && r.outcome === "rejected",
    );
    if (ruleDown) {
      runtime.push({
        id: rt.id,
        outcome: "NOT_RUN",
        message: `rule not deployed: ${ruleDown.problem ?? "unknown"}`,
      });
      continue;
    }
    const r = seen.get(rt.id);
    runtime.push({ id: rt.id, outcome: r?.outcome ?? "NOT_RUN", message: r?.message });
  }
}

// ---- flow value probes: run the interviews, read the output variables ----

const flowValues: CtxFlowValueResult[] = [];

if (!skipRuntime && (!only || only === "flow_values")) {
  const anyFlowLive = plan.flowValueProbes.some((fv) =>
    probeResults.some(
      (r) => r.id === `flowvalue:${fv.id}` && r.outcome === "accepted",
    ),
  );
  if (plan.flowValueProbes.length > 0 && anyFlowLive) {
    console.log("flow values: running interviews…");
    const run = sfJson(["apex", "run", "--file", "flows-run.apex", "-o", org]);
    if (!run.result?.success) {
      console.warn(
        `flows-run.apex failed: ${run.result?.compileProblem || run.result?.exceptionMessage || "unknown"}`,
      );
    }
    const raw: string = run.result?.logs ?? "";
    writeFileSync(join(ROOT, "results", "ctx-flow-log.txt"), raw);
    const logs = raw
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    const seen = new Map<string, { outcome: "VALUE" | "ERROR"; value: string }>();
    for (const m of logs.matchAll(/CTXRESULT\|([^|]+)\|(FLOWVAL64|FLOWERR)\|([^\n]*)/g)) {
      const [, id, kind, payload] = m;
      seen.set(id, {
        outcome: kind === "FLOWVAL64" ? "VALUE" : "ERROR",
        value:
          kind === "FLOWVAL64"
            ? Buffer.from(payload.trim(), "base64").toString("utf8")
            : payload.trim(),
      });
    }
    for (const fv of plan.flowValueProbes) {
      const r = seen.get(fv.id);
      flowValues.push({
        id: fv.id,
        outcome: r?.outcome ?? "NOT_RUN",
        value: r?.value,
      });
    }
  }
}

// ---- org identity + write ----

const display = sfJson(["org", "display", "-o", org]).result ?? {};
const orgRow =
  sfJson([
    "data",
    "query",
    "-q",
    "SELECT TimeZoneSidKey, OrganizationType FROM Organization",
    "-o",
    org,
  ]).result?.records?.[0] ?? {};

const results: CtxResults = {
  collectedAt: new Date().toISOString(),
  org: {
    id: display.id,
    username: display.username,
    instanceUrl: display.instanceUrl,
    apiVersion: display.apiVersion,
    timeZone: orgRow.TimeZoneSidKey,
    orgType: orgRow.OrganizationType,
  },
  containerStatus,
  probes: probeResults,
  untestable: plan.untestable,
  runtime,
  flowValues,
};
const stamp = results.collectedAt.slice(0, 10);
// A partial (--only) run must never clobber a full run's results.
const suffix = only ? `-only-${only.replace(/[^A-Za-z0-9_-]+/g, "_")}` : "";
const outPath = join(ROOT, "results", `ctx-run-${stamp}${suffix}.json`);
writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log("wrote", outPath);

// ---- human summary ----

for (const s of containerStatus) {
  console.log(`${s.verifiable ? "✅" : "⛔"} ${s.container}: ${s.detail}`);
}
for (const rt of plan.runtimeProbes) {
  const r = runtime.find((x) => x.id === rt.id);
  if (!r || r.outcome === "NOT_RUN") {
    continue;
  }
  const meaning = rt.interpret[r.outcome] ?? "(no interpretation)";
  console.log(
    `\n${rt.id}: ${r.outcome}${r.message ? ` — ${r.message.slice(0, 140)}` : ""}\n  ⇒ ${meaning}`,
  );
}
for (const fv of flowValues) {
  console.log(`\n${fv.id}: ${fv.outcome} — ${(fv.value ?? "").slice(0, 160)}`);
}
