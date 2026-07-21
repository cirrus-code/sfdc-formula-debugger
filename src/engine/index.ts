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
