/**
 * registry/ — function metadata table + formula-context configs.
 *
 * The single source of truth for signatures, per-context availability,
 * simulatability, docs URLs, and lint notes. Adding a function or context is a
 * data change, not a code change (except new evaluator implementations).
 *
 * The tables are seeded in Phase 2 (functions ported from formulon) and Phase 3
 * (evaluator impls). For now they are empty but typed, so higher layers can be
 * written against a stable API.
 *
 * May depend on: syntax/.
 */
export * from "./types.ts";

import type { FormulaContext, FunctionSpec } from "./types.ts";

export const FUNCTIONS: readonly FunctionSpec[] = [];
export const CONTEXTS: readonly FormulaContext[] = [];

const functionsByName: ReadonlyMap<string, FunctionSpec> = new Map(
  FUNCTIONS.map((f) => [f.name, f]),
);

/** Look up a function spec by name, case-insensitively. */
export function getFunction(name: string): FunctionSpec | undefined {
  return functionsByName.get(name.toUpperCase());
}

/** Look up a formula context by id. */
export function getContext(id: string): FormulaContext | undefined {
  return CONTEXTS.find((c) => c.id === id);
}
