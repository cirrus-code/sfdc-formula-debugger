// Run the org pass: deploy generated metadata (per-component failures are
// verdicts, not fatal), load probe records, read every formula field back, and
// write a joined results file for emit.ts.
//
//   pnpm collect -- --org <alias> [--skip-deploy] [--skip-data]

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      // A FORCE_COLOR in the caller's env makes oclif colorize --json output,
      // which breaks parsing; force it off for the child.
      env: { ...process.env, FORCE_COLOR: "0" },
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
//
// A metadata deploy is effectively all-or-nothing per request on current orgs:
// one invalid formula field makes the org discard every other component in the
// package, even with --ignore-errors (the response then counts only the failed
// components — nothing persists). So the pass deploys in rounds: each round
// records the rejections (often the verdict itself), drops them from the
// package, and retries, until a round lands clean. The expected-rejection
// probes go through the same loop as a separate second batch so their
// rejections cannot suppress the main metadata.

type DeployMap = Record<string, { deployed: boolean; problem?: string }>;
let deployMap: DeployMap = {};

if (skipDeploy) {
  deployMap = JSON.parse(readFileSync(DEPLOY_MAP, "utf8"));
  console.log("skip-deploy: reusing", DEPLOY_MAP);
} else {
  console.log("converting source to metadata format…");
  const convertDir = join(ROOT, "results", "mdapi-src");
  rmSync(convertDir, { recursive: true, force: true });
  sfJson(
    [
      "project",
      "convert",
      "source",
      "--source-dir",
      "force-app",
      "--output-dir",
      convertDir,
    ],
    join(ROOT, "sfdx"),
  );
  const objectSrc = readFileSync(
    join(convertDir, "objects", `${plan.objectApiName}.object`),
    "utf8",
  );
  // A field block's first <fullName> is the field's own (nested ones, e.g.
  // picklist values, come later).
  const FIELD_RE = / {4}<fields>[\s\S]*?<\/fields>\n/g;
  const nameOf = (block: string) => block.match(/<fullName>([^<]+)/)![1];

  const asArray = (x: unknown) => {
    if (Array.isArray(x)) {
      return x;
    }
    return x ? [x] : [];
  };

  const pkgDir = join(ROOT, "results", "deploy-pkg");
  const deployRounds = (
    label: string,
    fields: string[],
    withObject: boolean,
  ) => {
    const pending = new Set(fields);
    for (let round = 1; pending.size > 0; round++) {
      if (round > 8) {
        throw new Error(`${label}: still failing after 8 deploy rounds`);
      }
      rmSync(pkgDir, { recursive: true, force: true });
      mkdirSync(join(pkgDir, "objects"), { recursive: true });
      writeFileSync(
        join(pkgDir, "objects", `${plan.objectApiName}.object`),
        objectSrc.replace(FIELD_RE, (block) =>
          pending.has(nameOf(block)) ? block : "",
        ),
      );
      const objectMember = withObject
        ? `    <types>\n        <members>${plan.objectApiName}</members>\n        <name>CustomObject</name>\n    </types>\n`
        : "";
      writeFileSync(
        join(pkgDir, "package.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <types>\n${[
          ...pending,
        ]
          .sort()
          .map((m) => `        <members>${plan.objectApiName}.${m}</members>`)
          .join(
            "\n",
          )}\n        <name>CustomField</name>\n    </types>\n${objectMember}    <version>62.0</version>\n</Package>\n`,
      );
      console.log(`${label}: deploy round ${round}, ${pending.size} fields…`);
      const res = sfJson(
        [
          "project",
          "deploy",
          "start",
          "--metadata-dir",
          pkgDir,
          "-o",
          org,
          "--ignore-errors",
          "--wait",
          "33",
        ],
        ROOT,
      );
      const failures = asArray(res.result?.details?.componentFailures).filter(
        (c) => c.fullName !== "package.xml",
      );
      if (failures.length === 0) {
        for (const m of pending) {
          deployMap[`${plan.objectApiName}.${m}`] = { deployed: true };
        }
        console.log(`${label}: ${pending.size} components deployed`);
        return;
      }
      for (const c of failures) {
        deployMap[c.fullName] = { deployed: false, problem: c.problem };
        pending.delete(c.fullName.replace(`${plan.objectApiName}.`, ""));
        console.log(`  rejected: ${c.fullName} — ${c.problem}`);
      }
    }
  };

  const expectErr = new Set(
    plan.formulaFields
      .filter((ff) => ff.expectSaveError !== undefined)
      .map((ff) => ff.apiName),
  );
  const allFields = [...objectSrc.matchAll(FIELD_RE)].map((m) => nameOf(m[0]));
  deployRounds(
    "main metadata",
    allFields.filter((f) => !expectErr.has(f)),
    true,
  );
  deployRounds(
    "expected-rejection probes",
    allFields.filter((f) => expectErr.has(f)),
    false,
  );

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

// ---- field access ----
//
// API-deployed fields carry no field-level security, and anonymous Apex and
// SOQL both run as the CLI user, so without a grant the fields are invisible
// ("Field does not exist" at Apex compile). Deploy and assign a permission set
// covering exactly the fields that survived deployment.

const PERMSET = "FxProbe_Access";
{
  const permDir = join(ROOT, "results", "permset-pkg");
  rmSync(permDir, { recursive: true, force: true });
  mkdirSync(join(permDir, "permissionsets"), { recursive: true });
  const entry = (api: string, editable: boolean) =>
    `    <fieldPermissions>\n        <editable>${editable}</editable>\n        <field>${plan.objectApiName}.${api}</field>\n        <readable>true</readable>\n    </fieldPermissions>`;
  const rows = [
    entry("ProbeKey__c", true),
    ...plan.inputFields.map((f) => entry(f.apiName, true)),
    ...plan.formulaFields
      .filter((ff) => fieldStatus(ff).deployed)
      .map((ff) => entry(ff.apiName, false)),
  ];
  writeFileSync(
    join(permDir, "permissionsets", `${PERMSET}.permissionset`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">\n${rows.join(
      "\n",
    )}\n    <label>FxProbe Access</label>\n    <objectPermissions>\n        <allowCreate>true</allowCreate>\n        <allowDelete>true</allowDelete>\n        <allowEdit>true</allowEdit>\n        <allowRead>true</allowRead>\n        <modifyAllRecords>true</modifyAllRecords>\n        <viewAllRecords>true</viewAllRecords>\n        <object>${plan.objectApiName}</object>\n    </objectPermissions>\n</PermissionSet>\n`,
  );
  writeFileSync(
    join(permDir, "package.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <types>\n        <members>${PERMSET}</members>\n        <name>PermissionSet</name>\n    </types>\n    <version>62.0</version>\n</Package>\n`,
  );
  console.log("granting field access (permission set)…");
  const res = sfJson(
    [
      "project",
      "deploy",
      "start",
      "--metadata-dir",
      permDir,
      "-o",
      org,
      "--wait",
      "20",
    ],
    ROOT,
  );
  if (res.result?.status !== "Succeeded") {
    throw new Error(
      `permission set deploy failed: ${JSON.stringify(res.result?.details?.componentFailures)}`,
    );
  }
  const assign = sfJson(
    ["org", "permset", "assign", "--name", PERMSET, "-o", org],
    ROOT,
  );
  const assignFailures = (assign.result?.failures ?? []).filter(
    (f: { message?: string }) => !/uplicate/.test(f.message ?? ""),
  );
  if (assignFailures.length > 0) {
    throw new Error(
      `permission set assignment failed: ${JSON.stringify(assignFailures)}`,
    );
  }
}

// ---- data ----

if (!skipData) {
  const scripts = readdirSync(ROOT)
    .filter((f) => /^data-\d+\.apex$/.test(f))
    .sort();
  if (scripts.length === 0) {
    throw new Error("no data-*.apex scripts found; run pnpm generate first");
  }
  for (const script of scripts) {
    console.log(`loading probe records… (${script})`);
    const run = sfJson(["apex", "run", "--file", script, "-o", org], ROOT);
    if (!run.result?.success) {
      const why =
        run.result?.compileProblem ||
        run.result?.exceptionMessage ||
        run.message ||
        JSON.stringify(run);
      throw new Error(`${script} failed: ${why}`);
    }
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
