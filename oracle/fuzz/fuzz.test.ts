import { describe, expect, it } from "vitest";
import { parse } from "../../src/syntax/index.ts";
import { generateFormulas } from "./generate.ts";
import {
  buildProbes,
  parseOracleOutput,
  renderProbeFile,
  type Probe,
} from "./probes.ts";
import { diffProbes } from "./differential.ts";
import { triage } from "./triage.ts";

/**
 * WS4 fuzzer unit suite. The JVM leg is mocked with harness transcripts so this
 * runs in the ordinary test pass — a real oracle run is a manual command
 * (oracle/README.md).
 */

describe("generator", () => {
  it("is a pure function of the seed", () => {
    const a = generateFormulas({ seed: 7, count: 40 });
    const b = generateFormulas({ seed: 7, count: 40 });
    const other = generateFormulas({ seed: 8, count: 40 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);
  });

  it("emits well-typed formulas that parse without diagnostics", () => {
    for (const g of generateFormulas({ seed: 3, count: 300 })) {
      const { diagnostics } = parse(g.formula);
      expect(
        diagnostics,
        `${g.formula}: ${JSON.stringify(diagnostics)}`,
      ).toEqual([]);
    }
  });

  it("never emits probe-file delimiters or duplicates", () => {
    const formulas = generateFormulas({ seed: 11, count: 200 });
    expect(new Set(formulas.map((f) => f.formula)).size).toBe(formulas.length);
    for (const g of formulas) {
      expect(/[\t\n\r]/.test(g.formula)).toBe(false);
    }
  });
});

describe("probe encoding", () => {
  it("emits one field-valued line per formula per blank mode", () => {
    const probes = buildProbes([{ formula: '1 + LEN("ab")', type: "Number" }]);
    expect(renderProbeFile(probes)).toBe(
      'DOUBLE\tzero\t1 + LEN("ab")\t\nDOUBLE\tblank\t1 + LEN("ab")\t\n',
    );
  });

  it("decodes values, nulls and errors from the harness transcript", () => {
    const stdout = [
      "DOUBLE\t1/3\tBigDecimal\t0.333",
      'TEXT\tLEFT("", 3)\tnull\tnull',
      "DOUBLE\tMOD(10, 0)\tERROR\tArithmeticException: Division by zero",
      'DOUBLE\tVALUE("abc")\tERROR\tExecutionError: java.lang.ExceptionInInitializerError',
      "",
    ].join("\n");
    expect(parseOracleOutput(stdout)).toEqual([
      { formula: "1/3", expected: "0.333", infra: false },
      { formula: 'LEFT("", 3)', expected: "null", infra: false },
      {
        formula: "MOD(10, 0)",
        expected: "Error: ArithmeticException: Division by zero",
        infra: false,
      },
      {
        formula: 'VALUE("abc")',
        expected:
          "Error: ExecutionError: java.lang.ExceptionInInitializerError",
        infra: true,
      },
    ]);
  });
});

describe("triage", () => {
  const base = { blankMode: "zero" } as const;

  it("routes the org-overruled MOD(x, 0) error to known divergence", () => {
    expect(
      triage({
        ...base,
        formula: "MOD(3, 0)",
        oracle: "Error: ArithmeticException: Division by zero",
        ours: "3",
      }).bucket,
    ).toBe("known-divergence");
  });

  it("routes a TEXT() digit-budget difference to known divergence", () => {
    expect(
      triage({
        ...base,
        formula: "TEXT(1 / 3)",
        oracle: "0.333333333333333333333333333333333333333",
        ours: ".3333333333333333333333333333333333333333",
      }).bucket,
    ).toBe("known-divergence");
  });

  it("recognizes a TEXT() rendering difference inside a longer string", () => {
    expect(
      triage({
        ...base,
        formula: "TEXT(3.75) & TEXT(1 / 3)",
        oracle: "3.750.333333333333333333333333333333333333333",
        ours: "3.75.3333333333333333333333333333333333333333",
      }).bucket,
    ).toBe("known-divergence");
  });

  it("recognizes the `^` double-precision path", () => {
    expect(
      triage({
        ...base,
        formula: "((7 - 9) - MFLOOR(10)) / MIN((1), (9) ^ -2)",
        oracle: "-972.00000000000000097200000000000000",
        ours: "-971.9999999999999999999999999996598",
      }).bucket,
    ).toBe("known-divergence");
  });

  it("sends the oracle's blank-where-we-compute to an org probe", () => {
    expect(
      triage({
        ...base,
        formula: '"" < "a"',
        oracle: "null",
        ours: "true",
      }).bucket,
    ).toBe("org-probe-candidate");
  });

  it("sends negative-digit rounding to an org probe", () => {
    expect(
      triage({
        ...base,
        formula: 'ROUND(LEN(" " & "abcabc"), -1)',
        oracle: "0",
        ours: "10",
      }).bucket,
    ).toBe("org-probe-candidate");
  });

  it("treats an oracle-only error over a computed value as an org question", () => {
    expect(
      triage({
        ...base,
        formula: 'LEN("abc") + 1',
        oracle: "Error: FormulaEvaluationException: something",
        ours: "4",
      }).bucket,
    ).toBe("org-probe-candidate");
  });

  it("treats a shared-precision numeric tail as an org question", () => {
    expect(
      triage({
        ...base,
        formula: "1 / 7",
        oracle: "0.14285714285714285714285714285714",
        ours: "0.142857142857142857142857142857142857",
      }).bucket,
    ).toBe("org-probe-candidate");
  });

  it("calls a plain value disagreement our bug", () => {
    expect(
      triage({ ...base, formula: "2 * 3", oracle: "7", ours: "6" }).bucket,
    ).toBe("our-bug");
  });
});

describe("diffProbes against a mocked oracle", () => {
  const probes: readonly Probe[] = [
    { formula: "1 + 1", type: "Number", blankMode: "zero" },
    { formula: "2 * 3", type: "Number", blankMode: "zero" },
    { formula: 'VALUE("abc")', type: "Number", blankMode: "zero" },
  ];
  const transcript = [
    "DOUBLE\t1 + 1\tBigDecimal\t2",
    "DOUBLE\t2 * 3\tBigDecimal\t7",
    'DOUBLE\tVALUE("abc")\tERROR\tExecutionError: java.lang.ExceptionInInitializerError',
  ].join("\n");

  it("separates agreement, disagreement and unreportable probes", () => {
    const diff = diffProbes(probes, parseOracleOutput(transcript));
    expect(diff.summary.agree).toBe(1);
    expect(diff.summary.differ).toBe(1);
    expect(diff.summary.inconclusive).toBe(1);
    expect(diff.discrepancies[0]).toMatchObject({
      formula: "2 * 3",
      ours: "6",
      oracle: "7",
      verdict: { bucket: "our-bug" },
    });
  });

  it("refuses to compare a transcript that does not line up", () => {
    const short = parseOracleOutput("DOUBLE\t1 + 1\tBigDecimal\t2");
    expect(() => diffProbes(probes, short)).toThrow(/positionally/);
    const drifted = parseOracleOutput(
      [
        "DOUBLE\t1 + 1\tBigDecimal\t2",
        "DOUBLE\t9 * 9\tBigDecimal\t81",
        'DOUBLE\tVALUE("abc")\tnull\tnull',
      ].join("\n"),
    );
    expect(() => diffProbes(probes, drifted)).toThrow(/drifted/);
  });
});
