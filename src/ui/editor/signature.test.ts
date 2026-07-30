import { expect, test } from "vitest";
import type { FunctionSpec, ParamSpec } from "../../registry/index.ts";
import { insertionTemplate } from "./signature.ts";

function spec(params: readonly ParamSpec[]): FunctionSpec {
  return {
    name: "FN",
    params,
    returnType: { kind: "fixed", type: "Number" },
    contexts: "all",
    simulatable: true,
    docsUrl: "",
    summary: "",
  };
}

const p = (name: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({
  name,
  type: "Unknown",
  ...extra,
});

test("zero-arg functions produce an empty call", () => {
  expect(insertionTemplate(spec([]))).toBe("FN()");
});

test("required params become snippet fields in order", () => {
  expect(insertionTemplate(spec([p("a"), p("b")]))).toBe("FN(${a}, ${b})");
});

test("optional params are dropped from the skeleton", () => {
  expect(insertionTemplate(spec([p("a"), p("b", { optional: true })]))).toBe(
    "FN(${a})",
  );
});

test("a variadic tail appears exactly once", () => {
  expect(insertionTemplate(spec([p("a"), p("more", { variadic: true })]))).toBe(
    "FN(${a}, ${more})",
  );
});
