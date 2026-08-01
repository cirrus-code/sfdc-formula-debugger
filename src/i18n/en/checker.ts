/**
 * Type-checker diagnostic prose (src/analysis/checker.ts). Diagnostic codes
 * are the stable, tested identifiers; these messages are the human-readable
 * text shown in the Problems panel and are free to be reworded per locale.
 */
export const checker = {
  returnTypeMismatch: (
    contextLabel: string,
    required: string,
    actual: string,
  ) =>
    `${contextLabel} must return ${required}, but this formula returns ${actual}.`,
  unaryOperatorTypeMismatch: (op: string, operand: string) =>
    `Unary '${op}' expects a number, got ${operand}.`,
  operatorTypeMismatch: (op: string, type: string) =>
    `Operator '${op}' expects a number, got ${type}.`,
  comparisonTypeMismatch: (left: string, right: string, op: string) =>
    `Cannot compare ${left} and ${right} with '${op}'.`,
  nonstandardOperator: (op: string, replacement: string) =>
    `'${op}' is valid; '${replacement}' is the conventional Salesforce form.`,
  logicalOperatorTypeMismatch: (op: string, type: string) =>
    `Operator '${op}' expects a checkbox (boolean), got ${type}.`,
  unknownFunction: (name: string) => `Unknown function '${name}'.`,
  wrongArity: (name: string, arity: string, got: number) =>
    `${name} expects ${arity} argument(s), got ${got}.`,
  /** Composes the arity fragment inside `wrongArity`; `max: null` means unbounded. */
  arity: (min: number, max: number | null) => {
    if (max === null) {
      return `at least ${min}`;
    }
    if (min === max) {
      return `${min}`;
    }
    return `${min}–${max}`;
  },
  argumentTypeMismatch: (
    name: string,
    param: string,
    expected: string,
    actual: string,
  ) => `${name} argument '${param}' expects ${expected}, got ${actual}.`,
  argumentTypeRejected: (name: string, param: string, rejected: string) =>
    `${name} does not accept ${rejected} for '${param}' — Salesforce rejects this formula at save.`,
  functionNotAvailable: (name: string, contextLabel: string) =>
    `${name} is not available in ${contextLabel}.`,
};
