/**
 * WS4 differential fuzzer — probe-file encoding and oracle-output decoding.
 *
 * Speaks the harness's field-valued line shape (`TYPE <TAB> BLANKMODE <TAB>
 * FORMULA <TAB> FIELDS`) with an empty FIELDS column, which is the only way to
 * select the blank-handling mode; see oracle/README.md.
 */

import type { FuzzType, GeneratedFormula } from "./generate.ts";

export type BlankMode = "zero" | "blank";

export interface Probe {
  readonly formula: string;
  readonly type: FuzzType;
  readonly blankMode: BlankMode;
}

export interface OracleResult {
  /** Formula echoed back by the harness; used to detect line drift. */
  readonly formula: string;
  /** Corpus-shaped expectation: a rendered value, `"null"`, or `"Error: …"`. */
  readonly expected: string;
  /**
   * True when the harness failed to *report* rather than the engine failing to
   * evaluate — the open-source i18n layer throws while building the message for
   * a rejected formula, so the verdict is unknowable from this channel.
   */
  readonly infra: boolean;
}

const BLANK_MODES: readonly BlankMode[] = ["zero", "blank"];

/** MockFormulaDataType name the harness expects for a result type. */
export function oracleTypeName(type: FuzzType): string {
  switch (type) {
    case "Number":
      return "DOUBLE";
    case "Text":
      return "TEXT";
    case "Boolean":
      return "BOOLEAN";
    default: {
      const never: never = type;
      throw new Error(`unhandled fuzz type ${String(never)}`);
    }
  }
}

/** Corpus `dataType` spelling, so comparison reuses conformance.ts unchanged. */
export function corpusDataType(type: FuzzType): string {
  switch (type) {
    case "Number":
      return "Double";
    case "Text":
      return "Text";
    case "Boolean":
      return "Boolean";
    default: {
      const never: never = type;
      throw new Error(`unhandled fuzz type ${String(never)}`);
    }
  }
}

/** Every formula runs under both blank modes; the mode is free coverage. */
export function buildProbes(
  formulas: readonly GeneratedFormula[],
): readonly Probe[] {
  return formulas.flatMap((f) =>
    BLANK_MODES.map((blankMode) => ({
      formula: f.formula,
      type: f.type,
      blankMode,
    })),
  );
}

export function renderProbeFile(probes: readonly Probe[]): string {
  const lines = probes.map((p) => {
    if (/[\t\n\r]/.test(p.formula)) {
      throw new Error(`formula contains a probe-file delimiter: ${p.formula}`);
    }
    return `${oracleTypeName(p.type)}\t${p.blankMode}\t${p.formula}\t`;
  });
  return `${lines.join("\n")}\n`;
}

/**
 * The harness prints exactly one line per probe, in order, and does not echo
 * the blank mode — so results are matched positionally and the echoed formula
 * is only a consistency check.
 */
export function parseOracleOutput(stdout: string): readonly OracleResult[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parts = line.split("\t");
      const formula = parts[1] ?? "";
      const cls = parts[2] ?? "";
      const result = parts.slice(3).join("\t");
      if (cls === "ERROR") {
        return {
          formula,
          expected: `Error: ${result}`,
          infra: isInfra(result),
        };
      }
      if (cls === "null" || result === "null") {
        return { formula, expected: "null", infra: false };
      }
      return { formula, expected: result, infra: false };
    });
}

/**
 * Harness-side failures, not engine verdicts: the open-source engine's
 * placeholder i18n grammar cannot render a rejection message, so the throw that
 * surfaces is an initialization error rather than the formula's real outcome.
 */
function isInfra(message: string): boolean {
  return (
    /^(ExecutionError|NoClassDefFoundError|ExceptionInInitializerError)\b/.test(
      message,
    ) || message.includes("com.force.i18n")
  );
}
