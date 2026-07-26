import { describe, expect, it } from "vitest";
import { parse } from "../syntax/index.ts";
import { evaluateFormula, type EvalEnv } from "./evaluator.ts";
import {
  asBool,
  asDecimal,
  asText,
  blank,
  isError,
  UnsupportedError,
  type BlankMode,
  type SfValue,
} from "./value.ts";

function ev(
  source: string,
  opts: { fields?: Record<string, SfValue>; blankMode?: BlankMode } = {},
) {
  const env: EvalEnv = {
    fields: new Map(Object.entries(opts.fields ?? {})),
    blankMode: opts.blankMode ?? "zero",
    now: { epochMillis: Date.UTC(2026, 6, 21) },
  };
  return evaluateFormula(parse(source).ast, env);
}

function n(source: string, opts?: Parameters<typeof ev>[1]): string {
  const r = ev(source, opts);
  if (isError(r)) {
    throw new Error(`unexpected #Error: ${r.reason}`);
  }
  return asDecimal(r).toString();
}

function s(source: string, opts?: Parameters<typeof ev>[1]): string {
  const r = ev(source, opts);
  if (isError(r)) {
    throw new Error(`unexpected #Error: ${r.reason}`);
  }
  return asText(r);
}

function b(source: string, opts?: Parameters<typeof ev>[1]): boolean {
  const r = ev(source, opts);
  if (isError(r)) {
    throw new Error(`unexpected #Error: ${r.reason}`);
  }
  return asBool(r);
}

describe("engine: decimal arithmetic (no IEEE floats)", () => {
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

describe("engine: 39-sig-fig math, materialized to 32 places (oracle-verified)", () => {
  it("keeps guard digits through chained / and * so FLOOR((1/9)*9) = 1", () => {
    // Salesforce carries 39 sig-figs internally and rounds to 32 places only at
    // materialization, so (1/9)*9 rounds up to 1 rather than 0.999….
    expect(n("(1 / 9) * 9")).toBe("1");
    expect(n("FLOOR((1 / 9) * 9)")).toBe("1");
    expect(n("FLOOR((5 / 9) * 9)")).toBe("5");
  });

  it("materializes a bare division to 32 decimal places", () => {
    expect(n("1 / 3")).toBe(`0.${"3".repeat(32)}`);
  });
});

describe("engine: '+' concatenates text (oracle-verified)", () => {
  it("adds numbers but concatenates text operands", () => {
    expect(n("2 + 3")).toBe("5");
    expect(
      s("a + b", {
        fields: {
          a: { type: "Text", blank: false, data: "aaaa" },
          b: { type: "Text", blank: false, data: "bbbb" },
        },
      }),
    ).toBe("aaaabbbb");
  });

  it("propagates a blank text operand to null (unlike '&')", () => {
    const r = ev("a + b", {
      fields: {
        a: { type: "Text", blank: false, data: "x" },
        b: blank("Text"),
      },
    });
    expect(isError(r)).toBe(false);
    expect((r as SfValue).blank).toBe(true);
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
    expect(
      n("Amount + 1", {
        fields: { Amount: blank("Number") },
        blankMode: "zero",
      }),
    ).toBe("1");
  });

  it("propagates blank in blank mode", () => {
    const r = ev("Amount + 1", {
      fields: { Amount: blank("Number") },
      blankMode: "blank",
    });
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
    expect(
      s('IF(Flag, "y", "n")', { fields: { Flag: blank("Boolean") } }),
    ).toBe("n");
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
    if (v.type === "Date") {
      expect(v.data).toEqual({ year: 2020, month: 2, day: 29 });
    }
  });

  it("rejects an invalid date", () => {
    expect(isError(ev("DATE(2020, 13, 1)"))).toBe(true);
  });
});

describe("engine: FLOOR/CEILING round relative to zero (oracle-verified)", () => {
  it("FLOOR truncates toward zero, CEILING rounds away from zero", () => {
    expect(n("FLOOR(-0.4)")).toBe("0");
    expect(n("FLOOR(-1.4)")).toBe("-1");
    expect(n("CEILING(-0.4)")).toBe("-1");
    expect(n("CEILING(-1.4)")).toBe("-2");
    // Positives are unchanged.
    expect(n("FLOOR(20.8)")).toBe("20");
    expect(n("CEILING(20.2)")).toBe("21");
  });

  it("SQRT treats a signed -0 (from FLOOR) as 0, not an error", () => {
    expect(n("SQRT(FLOOR(-0.4))")).toBe("0");
  });
});

describe("engine: zero-mode reads blank numerics as real 0 (oracle-verified)", () => {
  const fields = { Amount: blank("Number"), Sub: { ...blank("Currency") } };
  it("ISNULL of a blank number is false in zero mode", () => {
    expect(b("ISNULL(Amount)", { fields, blankMode: "zero" })).toBe(false);
    expect(b("ISNULL(Amount)", { fields, blankMode: "blank" })).toBe(true);
  });

  it("NULLVALUE returns the (zeroed) field, not the substitute, in zero mode", () => {
    expect(n("NULLVALUE(Amount, 10)", { fields, blankMode: "zero" })).toBe("0");
    expect(n("NULLVALUE(Amount, 10)", { fields, blankMode: "blank" })).toBe(
      "10",
    );
  });
});

describe("engine: three-valued comparison under blank semantics (oracle-verified)", () => {
  const blankText = { t: blank("Text"), u: blank("Number") };
  it("ordering against a blank operand is false", () => {
    expect(b("u < 5", { fields: blankText, blankMode: "blank" })).toBe(false);
    expect(b("u >= 5", { fields: blankText, blankMode: "blank" })).toBe(false);
  });

  it("equality coerces a blank text field to the empty string", () => {
    expect(b('t = ""', { fields: blankText, blankMode: "blank" })).toBe(true);
    expect(b('t <> ""', { fields: blankText, blankMode: "blank" })).toBe(false);
  });

  it("a blank numeric makes both = and <> false (null propagates, not negates)", () => {
    // IF sees the null comparison as false and takes the else branch.
    expect(
      s('IF(u <> 5, "T", "F")', { fields: blankText, blankMode: "blank" }),
    ).toBe("F");
  });
});

describe("engine: blank propagation through functions (oracle-verified)", () => {
  it("propagates a blank arg to null in both modes, except blank-aware fns", () => {
    for (const mode of ["zero", "blank"] as const) {
      const r = ev("SUBSTITUTE(t, o, x)", {
        fields: { t: blank("Text"), o: blank("Text"), x: blank("Text") },
        blankMode: mode,
      });
      expect(isError(r)).toBe(false);
      expect((r as SfValue).blank).toBe(true);
    }
  });

  it("UPPER/LOWER absorb a blank to empty text (blank-aware)", () => {
    expect(s("UPPER(t)", { fields: { t: blank("Text") } })).toBe("");
    expect(n("LEN(t)", { fields: { t: blank("Text") } })).toBe("0");
  });
});

describe("engine: DATE bounds and truncation (oracle-verified)", () => {
  it("rejects an out-of-range year", () => {
    expect(isError(ev("DATE(10000, 1, 1)"))).toBe(true);
  });

  it("truncates fractional month/day toward zero", () => {
    expect(n("MONTH(DATE(2009, 3.5, 2))")).toBe("3");
    expect(n("DAY(DATE(2009, 12, 31.9))")).toBe("31");
  });
});

describe("engine: ported functions (corpus-verified)", () => {
  it("TRUNC truncates toward zero; MFLOOR/MCEILING are mathematical floor/ceil", () => {
    expect(n("TRUNC(1.99, 1)")).toBe("1.9");
    expect(n("TRUNC(-1.99)")).toBe("-1");
    // MFLOOR/MCEILING round toward ∓∞, unlike SF's toward-zero FLOOR/CEILING.
    expect(n("MFLOOR(-1.4)")).toBe("-2");
    expect(n("MCEILING(-1.4)")).toBe("-1");
  });

  it("SUBSTR is 1-based; start ≤ 1 reads from the start; negative counts from end", () => {
    expect(s('SUBSTR("123456", 2, 3)')).toBe("234");
    expect(s('SUBSTR("123456", 0)')).toBe("123456");
    expect(s('SUBSTR("123456", -1)')).toBe("6");
    // An out-of-range start is blank.
    expect((ev('SUBSTR("123456", -9)') as SfValue).blank).toBe(true);
  });

  it("INITCAP title-cases Unicode words; REVERSE/ASCII/CHR", () => {
    expect(
      s("INITCAP(t)", {
        fields: { t: { type: "Text", blank: false, data: "ångstrom" } },
      }),
    ).toBe("Ångstrom");
    expect(s('REVERSE("abc")')).toBe("cba");
    expect(n('ASCII("A")')).toBe("65");
    expect(s("CHR(65)")).toBe("A");
  });

  it("IFERROR falls back only on a simulated #Error, not on an unsupported refusal", () => {
    expect(n("IFERROR(1 / 0, 42)")).toBe("42");
    expect(n("IFERROR(7, 42)")).toBe("7");
    expect(() => ev("IFERROR(PRIORVALUE(Amount), 0)")).toThrow(
      UnsupportedError,
    );
  });
});

describe("engine: simulation boundary (refuse, never guess)", () => {
  it("refuses non-simulatable functions with UnsupportedError", () => {
    expect(() => ev("PRIORVALUE(Amount)")).toThrow(UnsupportedError);
    expect(() => ev("ISCHANGED(Amount)")).toThrow(UnsupportedError);
  });

  it("refuses transcendentals and IN rather than shipping a subtly-wrong value", () => {
    expect(() => ev("LN(2)")).toThrow(UnsupportedError);
    expect(() => ev("EXP(1)")).toThrow(UnsupportedError);
    expect(() => ev("IN(x, y)")).toThrow(UnsupportedError);
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
