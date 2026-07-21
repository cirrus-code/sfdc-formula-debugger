import { describe, expect, it } from "vitest";
import { FUNCTIONS } from "../registry/index.ts";
import { BUILTINS, SPECIAL_FORMS } from "./builtins.ts";

/**
 * Enforces the rule-1 invariant across the registry/engine boundary: a function
 * marked `simulatable` must have an implementation, and one marked
 * non-simulatable must NOT — so the evaluator's only options are a real answer
 * or an honest UnsupportedError, never a silent guess.
 */
describe("registry ↔ engine consistency", () => {
  it("every simulatable function has exactly one implementation path", () => {
    for (const spec of FUNCTIONS) {
      const impls =
        (BUILTINS[spec.name] ? 1 : 0) + (SPECIAL_FORMS[spec.name] ? 1 : 0);
      if (spec.simulatable) {
        expect(
          impls,
          `${spec.name} is simulatable but has ${impls} impls`,
        ).toBe(1);
      } else {
        expect(impls, `${spec.name} is not simulatable but has an impl`).toBe(
          0,
        );
      }
    }
  });

  it("has no orphan implementations without a registry entry", () => {
    const names = new Set(FUNCTIONS.map((f) => f.name));
    for (const name of [
      ...Object.keys(BUILTINS),
      ...Object.keys(SPECIAL_FORMS),
    ]) {
      expect(
        names.has(name),
        `${name} is implemented but not in the registry`,
      ).toBe(true);
    }
  });
});
