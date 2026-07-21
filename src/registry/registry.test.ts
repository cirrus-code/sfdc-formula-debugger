import { describe, expect, it } from "vitest";
import {
  CONTEXTS,
  FUNCTIONS,
  functionArity,
  getContext,
  getFunction,
} from "./index.ts";

const CONTEXT_IDS = new Set(CONTEXTS.map((c) => c.id));

describe("registry: function table consistency", () => {
  it("has unique, canonical uppercase names", () => {
    const seen = new Set<string>();
    for (const f of FUNCTIONS) {
      expect(f.name, `${f.name} should be uppercase`).toBe(
        f.name.toUpperCase(),
      );
      expect(seen.has(f.name), `${f.name} is duplicated`).toBe(false);
      seen.add(f.name);
    }
  });

  it("places optional and variadic params only in valid positions", () => {
    for (const f of FUNCTIONS) {
      f.params.forEach((p, i) => {
        // A variadic param must be last.
        if (p.variadic) {
          expect(i, `${f.name}: variadic must be last`).toBe(
            f.params.length - 1,
          );
        }
        // No required param may follow an optional one.
        if (i > 0 && f.params[i - 1]!.optional && !p.optional && !p.variadic) {
          throw new Error(
            `${f.name}: required param '${p.name}' follows an optional param`,
          );
        }
      });
    }
  });

  it("references only declared context ids", () => {
    for (const f of FUNCTIONS) {
      if (f.contexts === "all") {
        continue;
      }
      for (const id of f.contexts) {
        expect(
          CONTEXT_IDS.has(id),
          `${f.name} references unknown context '${id}'`,
        ).toBe(true);
      }
    }
  });

  it("keeps sameAsArg return rules within the parameter range", () => {
    for (const f of FUNCTIONS) {
      if (f.returnType.kind === "sameAsArg") {
        expect(f.returnType.index).toBeGreaterThanOrEqual(0);
        expect(
          f.returnType.index,
          `${f.name}: sameAsArg index out of range`,
        ).toBeLessThan(f.params.length);
      }
    }
  });

  it("gives every function a summary and docs URL", () => {
    for (const f of FUNCTIONS) {
      expect(f.summary.length, `${f.name} needs a summary`).toBeGreaterThan(0);
      expect(
        f.docsUrl.startsWith("https://"),
        `${f.name} needs an https docs URL`,
      ).toBe(true);
    }
  });

  it("computes sane arities", () => {
    expect(functionArity(getFunction("IF")!)).toEqual({ min: 3, max: 3 });
    expect(functionArity(getFunction("TODAY")!)).toEqual({ min: 0, max: 0 });
    expect(functionArity(getFunction("AND")!)).toEqual({
      min: 1,
      max: Number.POSITIVE_INFINITY,
    });
    expect(functionArity(getFunction("FIND")!)).toEqual({ min: 2, max: 3 });
  });
});

describe("registry: context configs", () => {
  it("has unique ids and at least the three Tier 1 contexts", () => {
    expect(new Set(CONTEXTS.map((c) => c.id)).size).toBe(CONTEXTS.length);
    for (const id of ["formula_field", "validation_rule", "flow_formula"]) {
      expect(getContext(id)?.tier).toBe(1);
    }
  });

  it("labels every Tier 2 context with an unverified-availability note", () => {
    for (const c of CONTEXTS) {
      if (c.tier === 2) {
        expect(c.notes, `${c.id} needs a Tier 2 note`).toBeTruthy();
      }
    }
  });

  it("resolves functions case-insensitively", () => {
    expect(getFunction("if")).toBe(getFunction("IF"));
    expect(getFunction("Today")?.name).toBe("TODAY");
  });
});
