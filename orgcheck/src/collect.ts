// Run the org pass: deploy generated metadata (per-component failures are
// verdicts, not fatal), load probe records, read every formula field back, and
// write a joined results file for emit.ts.
//
//   pnpm collect -- --org <alias> [--skip-deploy] [--skip-data]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plan, PlanFormulaField } from "./shared.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const SF = join(ROOT, "node_modules", ".bin", "sf");
const DEPLOY_MAP = join(ROOT, "results", "deploy-map.json");

const args = process.argv.slice(2);
const orgFlag = args.indexOf("--org");
if (orgFlag === -1 || !args[orgFlag + 1]) {
  console.error(
    "usage: pnpm collect -- --org <alias> [--skip-deploy] [--skip-data]",
  );
  process.exit(1);
}
const org = args[orgFlag + 1];
const skipDeploy = args.includes("--skip-deploy");
const skipData = args.includes("--skip-data");

// sf's result JSON is loosely typed per subcommand; callers pick fields out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sfJson(cmdArgs: string[], cwd: string): any {
  let stdout: string;
  try {
    stdout = execFileSync(SF, [...cmdArgs, "--json"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // sf exits non-zero on partial failure but still emits result JSON.
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

const plan: Plan = JSON.parse(readFileSync(join(ROOT, "plan.json"), "utf8"));
mkdirSync(join(ROOT, "results"), { recursive: true });

// ---- deploy ----

type DeployMap = Record<string, { deployed: boolean; problem?: string }>;
let deployMap: DeployMap = {};

if (skipDeploy) {
  deployMap = JSON.parse(readFileSync(DEPLOY_MAP, "utf8"));
  console.log("skip-deploy: reusing", DEPLOY_MAP);
} else {
  console.log("deploying probe metadata…");
  const deploy = sfJson(
    [
      "project",
      "deploy",
      "start",
      "--source-dir",
      "force-app",
      "-o",
      org,
      "--ignore-conflicts",
      "--ignore-errors",
      "--wait",
      "33",
    ],
    join(ROOT, "sfdx"),
  );
  const details = deploy.result?.details ?? {};
  const asArray = (x: unknown) => {
    if (Array.isArray(x)) {
      return x;
    }
    return x ? [x] : [];
  };
  for (const c of asArray(details.componentSuccesses)) {
    deployMap[c.fullName] = { deployed: true };
  }
  for (const c of asArray(details.componentFailures)) {
    deployMap[c.fullName] = { deployed: false, problem: c.problem };
  }
  writeFileSync(DEPLOY_MAP, JSON.stringify(deployMap, null, 1));
  const failed = Object.values(deployMap).filter((d) => !d.deployed).length;
  console.log(
    `deploy: ${Object.keys(deployMap).length} components, ${failed} rejected (rejections may be verdicts)`,
  );
}

function fieldStatus(ff: PlanFormulaField): {
  deployed: boolean;
  problem?: string;
} {
  return (
    deployMap[`${plan.objectApiName}.${ff.apiName}`] ??
      // Absent from both lists (e.g. unchanged since a prior deploy): assume live.
      { deployed: true }
  );
}

// ---- data ----

if (!skipData) {
  console.log("loading probe records…");
  const run = sfJson(["apex", "run", "--file", "data.apex", "-o", org], ROOT);
  if (!run.result?.success) {
    throw new Error(
      `data.apex failed: ${run.result?.exceptionMessage ?? JSON.stringify(run.result)}`,
    );
  }
}

// ---- read back ----

const liveFields = plan.formulaFields.filter((ff) => fieldStatus(ff).deployed);
const valuesByRecord = new Map<string, Record<string, unknown>>();
const CHUNK = 60;
for (let i = 0; i < liveFields.length; i += CHUNK) {
  const cols = liveFields.slice(i, i + CHUNK).map((ff) => ff.apiName);
  const soql = `SELECT ProbeKey__c, ${cols.join(", ")} FROM ${plan.objectApiName}`;
  const res = sfJson(["data", "query", "-q", soql, "-o", org], ROOT);
  for (const rec of res.result?.records ?? []) {
    const key = rec.ProbeKey__c as string;
    const existing = valuesByRecord.get(key) ?? {};
    for (const col of cols) {
      existing[col] = rec[col] ?? null;
    }
    valuesByRecord.set(key, existing);
  }
}
console.log(
  `queried ${liveFields.length} live formula fields across ${valuesByRecord.size} records`,
);

// ---- org identity (provenance for emitted corpus rows) ----

const display = sfJson(["org", "display", "-o", org], ROOT).result ?? {};
const orgRow =
  sfJson(
    [
      "data",
      "query",
      "-q",
      "SELECT TimeZoneSidKey, OrganizationType FROM Organization",
      "-o",
      org,
    ],
    ROOT,
  ).result?.records?.[0] ?? {};

// ---- join ----

const asString = (v: unknown): string | null => {
  if (v === null || v === undefined) {
    return null;
  }
  return typeof v === "string" ? v : String(v);
};

const twinText = new Map<string, Map<string, string | null>>(); // primary apiName → recordKey → text
for (const ff of plan.formulaFields) {
  if (ff.twinOf && fieldStatus(ff).deployed) {
    const byKey = new Map<string, string | null>();
    for (const row of ff.rows) {
      byKey.set(
        row.recordKey,
        asString(valuesByRecord.get(row.recordKey)?.[ff.apiName]),
      );
    }
    twinText.set(ff.twinOf, byKey);
  }
}

const probes = plan.formulaFields
  .filter((ff) => !ff.twinOf)
  .map((ff) => {
    const status = fieldStatus(ff);
    return {
      probeId: ff.probeId,
      apiName: ff.apiName,
      blankMode: ff.blankMode,
      formula: ff.formula,
      returns: ff.returns,
      question: ff.question,
      expectSaveError: ff.expectSaveError,
      interpret: ff.interpret,
      fieldAliases: ff.fieldAliases,
      deployed: status.deployed,
      deployError: status.problem,
      rows: status.deployed
        ? ff.rows.map((row) => ({
            recordKey: row.recordKey,
            fields: row.fields,
            oracleExpected: row.oracleExpected,
            value: asString(valuesByRecord.get(row.recordKey)?.[ff.apiName]),
            text: twinText.get(ff.apiName)?.get(row.recordKey) ?? null,
          }))
        : [],
    };
  });

const results = {
  collectedAt: new Date().toISOString(),
  org: {
    id: display.id,
    username: display.username,
    instanceUrl: display.instanceUrl,
    apiVersion: display.apiVersion,
    timeZone: orgRow.TimeZoneSidKey,
    orgType: orgRow.OrganizationType,
  },
  probes,
};
const stamp = results.collectedAt.slice(0, 10);
const outPath = join(ROOT, "results", `org-run-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log("wrote", outPath);

// ---- human summary: what did each contested probe decide? ----

for (const p of probes) {
  if (!p.interpret && p.expectSaveError === undefined) {
    continue;
  }
  const observed = p.deployed
    ? (p.rows[0]?.text ?? p.rows[0]?.value ?? "null")
    : "SAVE_ERROR";
  const meaning = p.interpret?.[observed ?? "null"];
  const detail = p.deployed
    ? `= ${observed}`
    : `save rejected: ${p.deployError}`;
  console.log(
    `\n${p.probeId} [${p.blankMode}] ${p.formula}\n  ${detail}${meaning ? `\n  ⇒ ${meaning}` : ""}`,
  );
}
