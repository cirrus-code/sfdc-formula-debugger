import Decimal from "decimal.js";
import type { SfType } from "../registry/index.ts";

/**
 * The Salesforce value domain (DESIGN §7). All numeric math goes through
 * decimal.js with round-half-up — never IEEE floats (CLAUDE.md rule 2). Blankness
 * is a first-class state of every value, not a separate type.
 */

// Round-half-up so ROUND(2.5) = 3; generous precision for intermediate math.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP, precision: 50 });
export { Decimal };

export type BlankMode = "zero" | "blank";

export interface DateParts {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number; // 1–31
}

/** A datetime as milliseconds since the Unix epoch, in GMT (Salesforce's zone). */
export interface DatetimeVal {
  readonly epochMillis: number;
}

/** A time-of-day as milliseconds since midnight. */
export interface TimeVal {
  readonly millisOfDay: number;
}

/**
 * A concrete formula value. `data` is always populated (a placeholder when
 * blank) so consumers never juggle undefined; `blank` is the authoritative
 * signal and must be checked before the data is used semantically.
 */
export type SfValue =
  | {
      readonly type: "Number" | "Currency" | "Percent";
      readonly blank: boolean;
      readonly data: Decimal;
    }
  | {
      readonly type: "Text" | "Id" | "Picklist" | "Multipicklist";
      readonly blank: boolean;
      readonly data: string;
    }
  | {
      readonly type: "Boolean";
      readonly blank: boolean;
      readonly data: boolean;
    }
  | { readonly type: "Date"; readonly blank: boolean; readonly data: DateParts }
  | {
      readonly type: "Datetime";
      readonly blank: boolean;
      readonly data: DatetimeVal;
    }
  | { readonly type: "Time"; readonly blank: boolean; readonly data: TimeVal }
  | { readonly type: "Unknown"; readonly blank: boolean; readonly data: null };

/**
 * A Salesforce runtime error (e.g. division by zero) — the `#Error!` a user
 * would see. It is a value-like result that propagates through evaluation, not
 * an exception, so the UI can render it distinctly (DESIGN §7).
 */
export interface FormulaError {
  readonly kind: "error";
  readonly reason: string;
}

export type EvalResult = SfValue | FormulaError;

export function isError(r: EvalResult): r is FormulaError {
  return (r as FormulaError).kind === "error";
}

export function error(reason: string): FormulaError {
  return { kind: "error", reason };
}

/**
 * Thrown when evaluation hits a construct outside the supported simulation
 * subset (a non-simulatable function). Distinct from FormulaError: this is "we
 * refuse to guess" (rule 1), not "Salesforce would show #Error!".
 */
export class UnsupportedError extends Error {
  constructor(readonly functionName: string) {
    super(`unsupported: ${functionName}`);
    this.name = "UnsupportedError";
  }
}

// --- Constructors --------------------------------------------------------

export function num(value: Decimal.Value): SfValue {
  return { type: "Number", blank: false, data: new Decimal(value) };
}

export function text(value: string): SfValue {
  return { type: "Text", blank: false, data: value };
}

export function bool(value: boolean): SfValue {
  return { type: "Boolean", blank: false, data: value };
}

export function dateValue(parts: DateParts): SfValue {
  return { type: "Date", blank: false, data: parts };
}

export function datetimeValue(epochMillis: number): SfValue {
  return { type: "Datetime", blank: false, data: { epochMillis } };
}

export function timeValue(millisOfDay: number): SfValue {
  return { type: "Time", blank: false, data: { millisOfDay } };
}

/** A blank (null) value of a given type. */
export function blank(type: SfType): SfValue {
  switch (type) {
    case "Number":
    case "Currency":
    case "Percent":
      return { type, blank: true, data: new Decimal(0) };
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return { type, blank: true, data: "" };
    case "Boolean":
      return { type: "Boolean", blank: true, data: false };
    case "Date":
      return {
        type: "Date",
        blank: true,
        data: { year: 1970, month: 1, day: 1 },
      };
    case "Datetime":
      return { type: "Datetime", blank: true, data: { epochMillis: 0 } };
    case "Time":
      return { type: "Time", blank: true, data: { millisOfDay: 0 } };
    case "Unknown":
      return { type: "Unknown", blank: true, data: null };
    default:
      return { type: "Unknown", blank: true, data: null };
  }
}

// --- Typed accessors (trust the `type` discriminant) ---------------------

export function asDecimal(v: SfValue): Decimal {
  if (v.type === "Number" || v.type === "Currency" || v.type === "Percent") {
    return v.data;
  }
  throw new Error(`Expected a number, got ${v.type}`);
}

export function asText(v: SfValue): string {
  if (
    v.type === "Text" ||
    v.type === "Id" ||
    v.type === "Picklist" ||
    v.type === "Multipicklist"
  ) {
    return v.data;
  }
  throw new Error(`Expected text, got ${v.type}`);
}

export function asBool(v: SfValue): boolean {
  if (v.type === "Boolean") {
    return v.data;
  }
  throw new Error(`Expected a boolean, got ${v.type}`);
}
