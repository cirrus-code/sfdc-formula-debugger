/**
 * WS4 differential fuzzer entry point (CONFORMANCE.md; see oracle/README.md).
 *
 * Feeds the same generated constant expressions to our evaluator and to the JVM
 * oracle, diffs them, and writes a triage report. It never writes corpus rows.
 *
 * The fuzzer core imports the app's evaluator from src/, whose TypeScript is
 * not erasable (constructor parameter properties), so plain `node` cannot load
 * it; Vite's SSR loader compiles it exactly the way vitest does. All I/O and
 * process control live in this file, keeping the core pure and testable.
 *
 * Usage:
 *   node oracle/fuzz/run.mjs [--seed N] [--count N] [--depth N] [--out FILE]
 *                            [--probes FILE] [--oracle-out FILE] [--no-oracle]
 *                            [--java PATH]
 *
 * `--oracle-out` replays a captured harness transcript instead of spawning the
 * JVM; `--no-oracle` stops after writing the probe file. `--java` (or $FUZZ_JAVA)
 * points at a JDK when node and java come from different Nix dev shells.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const oracleDir = resolve(here, "..");
const repoRoot = resolve(oracleDir, "..");

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    count: { type: "string", default: "2000" },
    depth: { type: "string", default: "3" },
    out: { type: "string" },
    probes: { type: "string" },
    "oracle-out": { type: "string" },
    "no-oracle": { type: "boolean", default: false },
    java: { type: "string" },
  },
});

const seed = Number(values.seed);
const count = Number(values.count);
const depth = Number(values.depth);
if (
  !Number.isFinite(seed) ||
  !Number.isFinite(count) ||
  !Number.isFinite(depth)
) {
  throw new Error("--seed, --count and --depth must be numbers");
}

const scratch = mkdtempSync(join(tmpdir(), "ws4-fuzz-"));
const probeFilePath = values.probes
  ? resolve(values.probes)
  : join(scratch, "probes.txt");
const reportPath = values.out
  ? resolve(values.out)
  : join(scratch, "ws4-report.md");

const server = await createServer({
  root: repoRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "warn",
});

try {
  const core = await server.ssrLoadModule("/oracle/fuzz/differential.ts");
  const probeParser = await server.ssrLoadModule("/oracle/fuzz/probes.ts");

  const plan = core.planFuzz({ seed, count, depth });
  writeFileSync(probeFilePath, plan.probeFile);
  process.stdout.write(
    `Generated ${plan.formulaCount} formulas -> ${plan.probes.length} probes: ${probeFilePath}\n`,
  );

  if (values["no-oracle"] && !values["oracle-out"]) {
    process.stdout.write("JVM leg skipped (--no-oracle); no report written.\n");
  } else {
    const { stdout, command } = values["oracle-out"]
      ? {
          stdout: readFileSync(resolve(values["oracle-out"]), "utf8"),
          command: `replay ${values["oracle-out"]}`,
        }
      : runOracle(probeFilePath);

    const diff = core.diffProbes(
      plan.probes,
      probeParser.parseOracleOutput(stdout),
    );
    const report = core.renderReport(
      {
        seed,
        count,
        depth,
        generatedAt: new Date().toISOString(),
        oracleCommand: command,
      },
      diff,
    );
    writeFileSync(reportPath, report);
    const s = diff.summary;
    process.stdout.write(
      `agree ${s.agree} · differ ${s.differ} · refused ${s.refusedByUs} · ` +
        `quarantine ${s.quarantine} · inconclusive ${s.inconclusive}\n` +
        `  (a) our-bug ${s.byBucket["our-bug"]} · ` +
        `(b) org-probe ${s.byBucket["org-probe-candidate"]} · ` +
        `(c) known divergence ${s.byBucket["known-divergence"]}\n` +
        `Report: ${reportPath}\n`,
    );
  }
} finally {
  await server.close();
}

/** Runs the compiled harness over the probe file, in batch (one JVM start). */
function runOracle(probeFile) {
  const java = values.java ?? process.env.FUZZ_JAVA ?? "java";
  const classpathFile = join(oracleDir, "cp.txt");
  const classes = join(oracleDir, "target", "classes");
  if (
    !existsSync(classpathFile) ||
    !existsSync(join(classes, "OracleHarness.class"))
  ) {
    throw new Error(
      `oracle harness is not built (missing ${classpathFile} or ${classes}). ` +
        "In `nix develop .#oracle`, run: mvn -q compile && " +
        "mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt",
    );
  }
  const classpath = `${classes}:${readFileSync(classpathFile, "utf8").trim()}`;
  const args = ["-cp", classpath, "OracleHarness", probeFile];
  const proc = spawnSync(java, args, {
    cwd: oracleDir,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (proc.error) {
    throw new Error(`could not run ${java}: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(
      `oracle exited ${proc.status}: ${proc.stderr?.slice(0, 2000)}`,
    );
  }
  return {
    stdout: proc.stdout,
    command: `${java} -cp <oracle classpath> OracleHarness`,
  };
}
