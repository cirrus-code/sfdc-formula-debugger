/**
 * engine/ — evaluator + Salesforce value domain (decimal.js).
 *
 * All Number/Currency/Percent math goes through decimal.js (round-half-up); no
 * IEEE floats. Honors the blank-handling mode. Hits the simulation boundary
 * hard: a non-simulatable function halts with UnsupportedError, never a guess.
 *
 * May depend on: registry/, syntax/.
 */
export * from "./value.ts";
export { evaluateFormula, type EvalEnv } from "./evaluator.ts";
// Part of the engine's public contract: TEXT() and `^` render/compute
// differently for syntactically-literal operands, so equivalence-preserving
// rewrites (the simplifier) must be able to see the same distinction.
export { isFoldedNumericLiteral } from "./builtins.ts";
