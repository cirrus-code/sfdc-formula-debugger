/**
 * registry/ — function metadata table + formula-context configs.
 *
 * The single source of truth for signatures, per-context availability,
 * simulatability, docs URLs, and lint notes. Adding a function or context is a
 * data change, not a code change (except new evaluator implementations).
 *
 * May depend on: syntax/.
 */
export * from "./types.ts";

import type { Arity, ContextId, FunctionSpec } from "./types.ts";
import { FUNCTIONS } from "./functions.ts";
import { CONTEXTS } from "./contexts.ts";

export { FUNCTIONS } from "./functions.ts";
export { CONTEXTS, DEFAULT_CONTEXT_ID } from "./contexts.ts";

const functionsByName: ReadonlyMap<string, FunctionSpec> = new Map(
  FUNCTIONS.map((f) => [f.name, f]),
);

/** Look up a function spec by name, case-insensitively (Salesforce is case-insensitive). */
export function getFunction(name: string): FunctionSpec | undefined {
  return functionsByName.get(name.toUpperCase());
}

/** Look up a formula context by id. */
export function getContext(id: string): (typeof CONTEXTS)[number] | undefined {
  return CONTEXTS.find((c) => c.id === id);
}

/**
 * Accepted argument-count range for a function. A trailing variadic param means
 * unbounded max; a non-optional variadic requires at least one such argument.
 *
 * When `contextId` is given and the spec has an org-verified `contextArity`
 * override for it, the override wins over the arity derived from `params`.
 */
export function functionArity(
  spec: FunctionSpec,
  contextId?: ContextId,
): Arity {
  const override = contextId ? spec.contextArity?.[contextId] : undefined;
  if (override) {
    return override;
  }
  let min = 0;
  let max = 0;
  let variadic = false;
  for (const p of spec.params) {
    if (p.variadic) {
      variadic = true;
      if (!p.optional) {
        min += 1;
      }
    } else {
      max += 1;
      if (!p.optional) {
        min += 1;
      }
    }
  }
  return { min, max: variadic ? Number.POSITIVE_INFINITY : max };
}
