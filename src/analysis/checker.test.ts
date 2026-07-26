import { describe, expect, it } from "vitest";
import { parse } from "../syntax/index.ts";
import { analyze } from "./checker.ts";

function codes(source: string, contextId = "formula_field"): string[] {
  return analyze(parse(source).ast, contextId).map((d) => d.code);
}

describe("checker: function validation", () => {
  it("accepts a well-formed call", () => {
    expect(codes("IF(ISBLANK(Amount), 0, Amount)")).toEqual([]);
  });

  it("flags an unknown function", () => {
    expect(codes("FOOBAR(1)")).toContain("unknown-function");
  });

  it("flags wrong arity", () => {
    expect(codes("LEFT(Name)")).toContain("wrong-arity");
    expect(codes("TODAY(1)")).toContain("wrong-arity");
  });

  it("accepts variadic calls", () => {
    expect(codes("AND(TRUE, FALSE, TRUE)")).toEqual([]);
    expect(codes("MAX(1, 2, 3, 4)")).toEqual([]);
  });

  it("accepts optional arguments", () => {
    expect(codes('FIND("a", "banana")')).toEqual([]);
    expect(codes('FIND("a", "banana", 3)')).toEqual([]);
  });

  it("flags a concrete argument type mismatch", () => {
    // LEN wants Text; a numeric literal is a concrete mismatch.
    expect(codes("LEN(5)")).toContain("argument-type-mismatch");
  });

  it("does not flag field arguments (Unknown suppresses type noise)", () => {
    expect(codes("LEN(Amount)")).toEqual([]);
  });
});

describe("checker: operators", () => {
  it("flags multiplying a string literal", () => {
    expect(codes('"a" * 2')).toContain("operator-type-mismatch");
  });

  it("allows date arithmetic", () => {
    expect(codes("TODAY() + 7")).toEqual([]);
    expect(codes("TODAY() - DATE(2020, 1, 1)")).toEqual([]);
  });

  it("flags == and != as nonstandard", () => {
    expect(codes("1 == 1")).toContain("nonstandard-operator");
    expect(codes("1 != 2")).toContain("nonstandard-operator");
  });

  it("flags && and || as nonstandard and expects boolean operands", () => {
    expect(codes("ISBLANK(x) && ISBLANK(y)")).toContain(
      "nonstandard-operator",
    );
    expect(codes("ISBLANK(x) || ISBLANK(y)")).toContain(
      "nonstandard-operator",
    );
    expect(codes("1 && 2")).toContain("operator-type-mismatch");
  });
});

describe("checker: context availability", () => {
  it("warns when a change function is used in a formula field", () => {
    expect(codes("ISCHANGED(Amount)", "formula_field")).toContain(
      "function-not-available",
    );
  });

  it("allows the same function in a validation rule", () => {
    expect(codes("ISCHANGED(Amount)", "validation_rule")).not.toContain(
      "function-not-available",
    );
  });

  it("suppresses availability findings in Tier 2 contexts", () => {
    expect(codes("ISCHANGED(Amount)", "workflow_field_update")).not.toContain(
      "function-not-available",
    );
  });

  it("warns for SUBSTR and IFERROR in a formula field (org-verified)", () => {
    expect(codes('SUBSTR("abc", 1)')).toContain("function-not-available");
    expect(codes("IFERROR(1 / 0, 0)")).toContain("function-not-available");
    expect(codes('SUBSTR("abc", 1)', "validation_rule")).not.toContain(
      "function-not-available",
    );
  });
});

describe("checker: return type", () => {
  it("warns when a validation rule does not return Boolean", () => {
    expect(codes('"hello"', "validation_rule")).toContain(
      "return-type-mismatch",
    );
  });

  it("accepts a Boolean formula in a validation rule", () => {
    expect(codes("Amount > 100", "validation_rule")).not.toContain(
      "return-type-mismatch",
    );
  });

  it("does not require a return type for formula fields", () => {
    expect(codes('"hello"', "formula_field")).toEqual([]);
  });
});
