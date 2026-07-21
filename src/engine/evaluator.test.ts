import { describe, expect, it } from "vitest";
import { parse } from "../syntax/index.ts";
import { evaluateFormula, type EvalEnv } from "./evaluator.ts";
import { asBool, asDecimal, asText, blank, isError, UnsupportedError, type BlankMode, type SfValue } from "./value.ts";

function ev(source: string, opts: { fields?: Record<string, SfValue>; blankMode?: BlankMode } = {}) {
  const env: EvalEnv = {
    fields: new Map(Object.entries(opts.fields ?? {})),
    blankMode: opts.blankMode ?? "zero",
    now: { epochMillis: Date.UTC(2026, 6, 21) },
  };
  return evaluateFormula(parse(source).ast, env);
}

function n(source: string, opts?: Parameters<typeof ev>[1]): string {
  const r = ev(source, opts);
  if (isError(r)) {throw new Error(`unexpected #Error: ${r.reason}`);}
  return asDecimal(r).toString();
}

function s(source: string, opts?: Parameters<typeof ev>[1]): string {
  const r = ev(source, opts);
  if (isError(r)) {throw new Error(`unexpected #Error: ${r.reason}`);}
  return asText(r);
}

function b(source: string, opts?: Parameters<typeof ev>[1]): boolean {
  const r = ev(source, opts);
  if (isError(r)) {throw new Error(`unexpected #Error: ${r.reason}`);}
  return asBool(r);
}

describe("engine: decimal arithmetic (rule 2)", () => {
  it("adds without IEEE error", () => {
    expect(n("0.1 + 0.2")).toBe("0.3");
  });

  it("rounds half up", () => {
    expect(n("ROUND(2.5, 0)")).toBe("3");
    expect(n("ROUND(1.005, 2)")).toBe("1.01");
  });

  it("respects the fixed operator precedence", () => {
    // * binds tighter than ^ (SF grammar): 2 * 3 ^ 2 = (2*3)^2 = 36.
    expect(n("2 * 3 ^ 2")).toBe("36");
  });
});

describe("engine: division by zero", () => {
  it("produces a simulated #Error, not a crash or null", () => {
    const r = ev("1 / 0");
    expect(isError(r)).toBe(true);
  });
});

describe("engine: blank-handling mode", () => {
  it("treats a blank number as zero in zero mode", () => {
    expect(n("Amount + 1", { fields: { Amount: blank("Number") }, blankMode: "zero" })).toBe("1");
  });

  it("propagates blank in blank mode", () => {
    const r = ev("Amount + 1", { fields: { Amount: blank("Number") }, blankMode: "blank" });
    expect(isError(r)).toBe(false);
    expect((r as SfValue).blank).toBe(true);
  });

  it("concatenates blank text as empty", () => {
    expect(s('"a" & b', { fields: { b: blank("Text") } })).toBe("a");
  });
});

describe("engine: blank predicates", () => {
  it("distinguishes ISBLANK from ISNULL on empty text", () => {
    expect(b('ISBLANK("")')).toBe(true);
    expect(b('ISNULL("")')).toBe(false);
  });

  it("treats a null checkbox as false", () => {
    expect(s('IF(Flag, "y", "n")', { fields: { Flag: blank("Boolean") } })).toBe("n");
  });
});

describe("engine: logical short-circuit and null coercion", () => {
  it("matches Salesforce AND-with-null behavior", () => {
    // From formulaTestV2.xml testIfAndNull: AND(null, x) and AND(x, null) => F.
    expect(
      s('IF(AND(NULL, Flag), "T", "F") & IF(AND(Flag, NULL), "T", "F")', {
        fields: { Flag: { type: "Boolean", blank: false, data: true } },
      }),
    ).toBe("FF");
  });

  it("short-circuits OR", () => {
    expect(b("OR(TRUE, 1 / 0 > 0)")).toBe(true);
  });
});

describe("engine: text and math functions", () => {
  it("evaluates text functions", () => {
    expect(n('LEN("hello")')).toBe("5");
    expect(s('LEFT("hello", 3)')).toBe("hel");
    expect(s('MID("hello", 2, 3)')).toBe("ell");
    expect(s('SUBSTITUTE("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(b('CONTAINS("banana", "nan")')).toBe(true);
  });

  it("evaluates math functions", () => {
    expect(n("ABS(-7)")).toBe("7");
    expect(n("MOD(7, 3)")).toBe("1");
    expect(n("MAX(3, 9, 2)")).toBe("9");
  });
});

describe("engine: CASE", () => {
  it("selects a matching branch and falls through to else", () => {
    expect(s('CASE(2, 1, "one", 2, "two", "other")')).toBe("two");
    expect(s('CASE(5, 1, "one", 2, "two", "other")')).toBe("other");
  });
});

describe("engine: dates", () => {
  it("builds and reads dates", () => {
    expect(n("YEAR(DATE(2026, 7, 21))")).toBe("2026");
    expect(n("MONTH(DATE(2026, 7, 21))")).toBe("7");
  });

  it("clamps ADDMONTHS to month end", () => {
    // Jan 31 + 1 month => Feb 29 (2020 is a leap year).
    const r = ev("ADDMONTHS(DATE(2020, 1, 31), 1)");
    expect(isError(r)).toBe(false);
    const v = r as SfValue;
    expect(v.type).toBe("Date");
    if (v.type === "Date") {expect(v.data).toEqual({ year: 2020, month: 2, day: 29 });}
  });

  it("rejects an invalid date", () => {
    expect(isError(ev("DATE(2020, 13, 1)"))).toBe(true);
  });
});

describe("engine: simulation boundary (rule 1)", () => {
  it("refuses non-simulatable functions with UnsupportedError", () => {
    expect(() => ev("PRIORVALUE(Amount)")).toThrow(UnsupportedError);
    expect(() => ev("ISCHANGED(Amount)")).toThrow(UnsupportedError);
  });

  it("names the unsupported function", () => {
    try {
      ev("VLOOKUP(a, b, c)");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedError);
      expect((e as UnsupportedError).functionName).toBe("VLOOKUP");
    }
  });
});
