import type { SfType } from "../registry/index.ts";

/**
 * Type compatibility for the checker. Deliberately permissive: `Unknown` unifies
 * with anything (DESIGN §6) so field references — whose types are not yet known —
 * never produce false positives, and related types (the numeric family, the
 * text family) are mutually assignable.
 */

const NUMERIC = new Set<SfType>(["Number", "Currency", "Percent"]);
const TEXTISH = new Set<SfType>(["Text", "Id", "Picklist", "Multipicklist"]);
const DATELIKE = new Set<SfType>(["Date", "Datetime", "Time"]);

export function isNumeric(t: SfType): boolean {
  return NUMERIC.has(t);
}

export function isDatelike(t: SfType): boolean {
  return DATELIKE.has(t);
}

/** Whether a value of type `actual` is acceptable where `expected` is wanted. */
export function isAssignable(actual: SfType, expected: SfType): boolean {
  if (actual === "Unknown" || expected === "Unknown") {
    return true;
  }
  if (actual === expected) {
    return true;
  }
  if (NUMERIC.has(actual) && NUMERIC.has(expected)) {
    return true;
  }
  if (TEXTISH.has(actual) && TEXTISH.has(expected)) {
    return true;
  }
  // The evaluator reads the GMT date out of a Datetime wherever a Date is
  // wanted (YEAR(NOW()), ADDMONTHS(datetime, n) — oracle-verified,
  // testIsoWeekWithDateTime and kin). One-directional: a Date supplies no
  // time, and Time stays incompatible with both.
  if (actual === "Datetime" && expected === "Date") {
    return true;
  }
  return false;
}

/** Whether two types can be meaningfully compared with `<`, `<=`, `>`, `>=`. */
export function isComparable(a: SfType, b: SfType): boolean {
  if (a === "Unknown" || b === "Unknown") {
    return true;
  }
  if (NUMERIC.has(a) && NUMERIC.has(b)) {
    return true;
  }
  if (TEXTISH.has(a) && TEXTISH.has(b)) {
    return true;
  }
  if (DATELIKE.has(a) && DATELIKE.has(b)) {
    return true;
  }
  return a === b;
}
