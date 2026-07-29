/**
 * WS4 differential fuzzer — the pure core: plan probes, evaluate them with our
 * engine, diff against the JVM oracle's answers, and render the triage report.
 *
 * All file, process and clock access lives in `run.mjs`; everything here is a
 * pure function of its inputs so the whole pipeline is testable with a mocked
 * oracle transcript.
 *
 * Comparison is delegated to `src/engine/conformance.ts` — the same `runRow`
 * the conformance suite uses — so the fuzzer cannot drift into a second,
 * friendlier notion of "equal".
 *
 * This tool never writes corpus rows. The oracle is the *second* tier of the
 * trust order; a difference it alone witnesses is a question for a real org,
 * not a golden expectation.
 */

import type { CorpusRow } from "../../src/engine/corpus.ts";
import { runRow } from "../../src/engine/conformance.ts";
import { generateFormulas, type FuzzOptions } from "./generate.ts";
import {
  buildProbes,
  corpusDataType,
  renderProbeFile,
  type OracleResult,
  type Probe,
} from "./probes.ts";
import { triage, type Bucket, type Verdict } from "./triage.ts";

export interface FuzzPlan {
  readonly probes: readonly Probe[];
  readonly probeFile: string;
  readonly formulaCount: number;
}

export interface Discrepancy {
  readonly formula: string;
  readonly blankMode: Probe["blankMode"];
  readonly dataType: string;
  readonly ours: string;
  readonly oracle: string;
  readonly verdict: Verdict;
}

export interface FuzzSummary {
  readonly formulas: number;
  readonly probes: number;
  readonly agree: number;
  readonly differ: number;
  readonly inconclusive: number;
  readonly quarantine: number;
  readonly refusedByUs: number;
  readonly byBucket: Readonly<Record<Bucket, number>>;
}

export interface FuzzDiff {
  readonly summary: FuzzSummary;
  readonly discrepancies: readonly Discrepancy[];
  /** Formulas our evaluator declined to simulate, for the report's tail. */
  readonly refusals: readonly string[];
  /** Probes the comparator could not judge either way. */
  readonly quarantined: readonly string[];
}

export interface ReportMeta {
  readonly seed: number;
  readonly count: number;
  readonly depth: number;
  readonly generatedAt: string;
  readonly oracleCommand: string;
}

export function planFuzz(opts: FuzzOptions): FuzzPlan {
  const formulas = generateFormulas(opts);
  const probes = buildProbes(formulas);
  return {
    probes,
    probeFile: renderProbeFile(probes),
    formulaCount: formulas.length,
  };
}

export function diffProbes(
  probes: readonly Probe[],
  oracleResults: readonly OracleResult[],
): FuzzDiff {
  if (probes.length !== oracleResults.length) {
    throw new Error(
      `oracle returned ${oracleResults.length} lines for ${probes.length} probes; ` +
        "results are matched positionally, so the run cannot be trusted",
    );
  }
  const byBucket: Record<Bucket, number> = {
    "our-bug": 0,
    "org-probe-candidate": 0,
    "known-divergence": 0,
    inconclusive: 0,
  };
  const discrepancies: Discrepancy[] = [];
  const refusals: string[] = [];
  const quarantined: string[] = [];
  let agree = 0;
  let inconclusive = 0;

  probes.forEach((probe, i) => {
    const oracle = oracleResults[i]!;
    if (oracle.formula !== probe.formula) {
      throw new Error(
        `oracle line ${i} echoes ${JSON.stringify(oracle.formula)} but probe ${i} is ` +
          `${JSON.stringify(probe.formula)}; positional matching has drifted`,
      );
    }
    if (oracle.infra) {
      inconclusive += 1;
      byBucket.inconclusive += 1;
      return;
    }
    const row: CorpusRow = {
      source: "ws4-fuzz (JVM oracle, not corpus-eligible)",
      name: `fuzz#${i}`,
      formula: probe.formula,
      dataType: corpusDataType(probe.type),
      fields: [],
      blankMode: probe.blankMode,
      expected: oracle.expected,
    };
    const outcome = safeRunRow(row);
    switch (outcome.status) {
      case "pass":
        agree += 1;
        return;
      case "unsupported":
        refusals.push(`[${probe.blankMode}] ${probe.formula}`);
        return;
      case "quarantine":
        quarantined.push(
          `[${probe.blankMode}] ${probe.formula} => oracle ${oracle.expected}`,
        );
        return;
      case "fail": {
        const ours = outcome.got ?? "";
        const verdict = triage({
          formula: probe.formula,
          blankMode: probe.blankMode,
          oracle: oracle.expected,
          ours,
        });
        byBucket[verdict.bucket] += 1;
        discrepancies.push({
          formula: probe.formula,
          blankMode: probe.blankMode,
          dataType: row.dataType,
          ours,
          oracle: oracle.expected,
          verdict,
        });
        return;
      }
      default: {
        const never: never = outcome.status;
        throw new Error(`unhandled row status ${String(never)}`);
      }
    }
  });

  return {
    summary: {
      formulas: new Set(probes.map((p) => p.formula)).size,
      probes: probes.length,
      agree,
      differ: discrepancies.length,
      inconclusive,
      quarantine: quarantined.length,
      refusedByUs: refusals.length,
      byBucket,
    },
    discrepancies,
    refusals,
    quarantined,
  };
}

/** An evaluator crash is itself a finding, so it is reported, not thrown. */
function safeRunRow(row: CorpusRow): ReturnType<typeof runRow> {
  try {
    return runRow(row);
  } catch (e) {
    return {
      status: "fail",
      got: `#Error(threw: ${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

const BUCKET_HEADINGS: Readonly<Record<Bucket, string>> = {
  "our-bug": "(a) Suspected our-bug",
  "org-probe-candidate":
    "(b) Suspected OSS-vs-product divergence — ORG-PROBE CANDIDATES",
  "known-divergence":
    "(c) Known intentional divergence (org already overruled)",
  inconclusive: "(d) Inconclusive — oracle channel could not report",
};

const MAX_LISTED = 80;

export function renderReport(meta: ReportMeta, diff: FuzzDiff): string {
  const s = diff.summary;
  const lines: string[] = [
    "# WS4 differential fuzz report",
    "",
    `Seed \`${meta.seed}\` · ${meta.count} requested formulas · depth ${meta.depth} · ` +
      `${s.formulas} generated · ${s.probes} probes (both blank modes)`,
    "",
    `Generated ${meta.generatedAt} · oracle: \`${meta.oracleCommand}\``,
    "",
    'The "ours" side is whatever `src/` holds at run time, so a report ages the',
    "moment the evaluator changes; re-run it rather than reading an old copy.",
    "",
    "> **Not a corpus source.** The oracle is tier 2 of the trust order",
    "> (`org-verified > formula-engine oracle > formulon`). Nothing in this",
    "> report may be written into `corpus/*.json`: bucket (b) rows are questions",
    "> for a real org (`orgcheck/`), and only an org answer earns a golden row.",
    "",
    "## Summary",
    "",
    "| outcome | probes |",
    "| --- | ---: |",
    `| agree | ${s.agree} |`,
    `| differ | ${s.differ} |`,
    `| our evaluator refused to simulate | ${s.refusedByUs} |`,
    `| not comparable (quarantine) | ${s.quarantine} |`,
    `| oracle channel unable to report | ${s.inconclusive} |`,
    "",
    "Differences by triage bucket:",
    "",
    "| bucket | count |",
    "| --- | ---: |",
    `| (a) suspected our-bug | ${s.byBucket["our-bug"]} |`,
    `| (b) org-probe candidate | ${s.byBucket["org-probe-candidate"]} |`,
    `| (c) known intentional divergence | ${s.byBucket["known-divergence"]} |`,
    `| (d) inconclusive (oracle channel) | ${s.byBucket.inconclusive} |`,
    "",
  ];

  const order: readonly Bucket[] = [
    "our-bug",
    "org-probe-candidate",
    "known-divergence",
  ];
  for (const bucket of order) {
    const rows = diff.discrepancies.filter((d) => d.verdict.bucket === bucket);
    lines.push(`## ${BUCKET_HEADINGS[bucket]} — ${rows.length}`, "");
    if (rows.length === 0) {
      lines.push("_None._", "");
      continue;
    }
    for (const d of rows.slice(0, MAX_LISTED)) {
      lines.push(
        `- \`${d.formula}\` _(${d.dataType}, ${d.blankMode} mode)_`,
        `  - ours: \`${d.ours}\``,
        `  - oracle: \`${d.oracle}\``,
        `  - triage: ${d.verdict.rationale}`,
      );
    }
    if (rows.length > MAX_LISTED) {
      lines.push("", `_… ${rows.length - MAX_LISTED} more omitted._`);
    }
    lines.push("");
  }

  lines.push(
    `## ${BUCKET_HEADINGS.inconclusive} — ${s.inconclusive}`,
    "",
    "The open-source engine's placeholder i18n grammar throws while building a",
    "rejection message, so the harness reports an initialization failure instead",
    "of the verdict. These probes carry no information in either direction.",
    "",
  );

  if (diff.refusals.length > 0) {
    lines.push(
      `## Our evaluator refused to simulate — ${diff.refusals.length}`,
      "",
      "Honest refusals (hard rule 1), not failures:",
      "",
      ...diff.refusals.slice(0, MAX_LISTED).map((r) => `- \`${r}\``),
      "",
    );
  }
  if (diff.quarantined.length > 0) {
    lines.push(
      `## Not comparable — ${diff.quarantined.length}`,
      "",
      ...diff.quarantined.slice(0, MAX_LISTED).map((q) => `- \`${q}\``),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
