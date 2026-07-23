import type { Expr } from "../syntax/index.ts";
import type { EvalEnv } from "./evaluator.ts";
import {
  asDecimal,
  asText,
  blank,
  bool,
  dateValue,
  datetimeValue,
  Decimal,
  error,
  isError,
  num,
  text,
  type DateParts,
  type EvalResult,
  type SfValue,
} from "./value.ts";

export type Builtin = (args: SfValue[], env: EvalEnv) => EvalResult;
export type Evaluate = (node: Expr, env: EvalEnv) => EvalResult;
export type SpecialForm = (
  args: readonly Expr[],
  env: EvalEnv,
  evaluate: Evaluate,
) => EvalResult;

// --- Coercion helpers ----------------------------------------------------

const ZERO = new Decimal(0);

/** Number input: a blank number reads as zero for function arguments. */
function dnum(v: SfValue): Decimal {
  return v.blank ? ZERO : asDecimal(v);
}

/** Text input: a blank reads as empty string. */
function dstr(v: SfValue): string {
  if (v.blank) {
    return "";
  }
  return isTextType(v) ? asText(v) : concatString(v);
}

/** Boolean input: a null checkbox reads as false (DESIGN §Salesforce semantics). */
function boolCoerce(v: SfValue): boolean {
  if (v.blank) {
    return false;
  }
  if (v.type === "Boolean") {
    return v.data;
  }
  throw new Error(`Expected a boolean, got ${v.type}`);
}

function isTextType(v: SfValue): boolean {
  return (
    v.type === "Text" ||
    v.type === "Id" ||
    v.type === "Picklist" ||
    v.type === "Multipicklist"
  );
}

function isBlankText(v: SfValue): boolean {
  return v.blank || (isTextType(v) && asText(v) === "");
}

/** Render a value for `&`/CONCATENATE (blank concatenates as empty). */
export function concatString(v: SfValue): string {
  if (v.blank) {
    return "";
  }
  switch (v.type) {
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return v.data;
    case "Number":
    case "Currency":
    case "Percent":
      return v.data.toString();
    case "Boolean":
      return v.data ? "True" : "False";
    case "Date":
      return formatDate(v.data);
    case "Datetime":
    case "Time":
    case "Unknown":
      return "";
    default:
      return "";
  }
}

// --- Date helpers --------------------------------------------------------

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    m - 1
  ]!;
}

// Salesforce rejects DATE() outside a supported year range: DATE(10000, …) is a
// runtime error while four-digit years evaluate. The exact upper bound (4000 vs
// 9999) is a NEEDS-VERIFICATION item; 9999 is the widest bound consistent with
// the corpus (VERIFICATION.md).
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

function isValidDate(p: DateParts): boolean {
  return (
    p.year >= MIN_YEAR &&
    p.year <= MAX_YEAR &&
    p.month >= 1 &&
    p.month <= 12 &&
    p.day >= 1 &&
    p.day <= daysInMonth(p.year, p.month)
  );
}

function formatDate(p: DateParts): string {
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

function dateFromEpoch(ms: number): DateParts {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

// --- Function table ------------------------------------------------------

export const BUILTINS: Record<string, Builtin> = {
  // Logical
  NOT: ([a]) => bool(!boolCoerce(a!)),
  ISBLANK: ([a]) => bool(isBlankText(a!) ? true : a!.blank),
  ISNULL: ([a]) => bool(a!.blank),
  ISNUMBER: ([a]) => bool(!a!.blank && isParsableNumber(dstr(a!))),
  ISPICKVAL: ([p, v]) => bool(dstr(p!) === dstr(v!)),
  NULLVALUE: ([expr, sub]) => (expr!.blank ? sub! : expr!),
  BLANKVALUE: ([expr, sub]) => (isBlankText(expr!) ? sub! : expr!),

  // Text
  LEN: ([a]) => num(dstr(a!).length),
  LEFT: ([a, n]) => textOrBlank(dstr(a!).slice(0, Math.max(0, toInt(n!)))),
  RIGHT: ([a, n]) => {
    const k = toInt(n!);
    return textOrBlank(k <= 0 ? "" : dstr(a!).slice(-k));
  },
  MID: ([a, start, len]) => {
    const from = Math.max(0, toInt(start!) - 1);
    return textOrBlank(dstr(a!).slice(from, from + Math.max(0, toInt(len!))));
  },
  TRIM: ([a]) => text(dstr(a!).trim()),
  UPPER: ([a]) => text(dstr(a!).toUpperCase()),
  LOWER: ([a]) => text(dstr(a!).toLowerCase()),
  CONTAINS: ([a, b]) => bool(dstr(a!).includes(dstr(b!))),
  BEGINS: ([a, b]) => bool(dstr(a!).startsWith(dstr(b!))),
  FIND: ([search, txt, start]) => {
    const from = start ? Math.max(0, toInt(start) - 1) : 0;
    const idx = dstr(txt!).indexOf(dstr(search!), from);
    return num(idx < 0 ? 0 : idx + 1);
  },
  SUBSTITUTE: ([a, oldT, newT]) => {
    const o = dstr(oldT!);
    return text(o === "" ? dstr(a!) : dstr(a!).split(o).join(dstr(newT!)));
  },
  CONCATENATE: (args) => text(args.map(concatString).join("")),
  SUBSTR: ([a, start, len]) => {
    const s = dstr(a!);
    // start ≤ 1 (including 0) reads from the beginning; a negative start counts
    // from the end; an out-of-range start yields blank.
    const from = substrStart(toInt(start!), s.length);
    if (from < 0 || from >= s.length) {
      return blank("Text");
    }
    return textOrBlank(
      len === undefined ? s.slice(from) : s.slice(from, from + toInt(len)),
    );
  },
  INITCAP: ([a]) => text(dstr(a!).replace(/[\p{L}\p{N}]+/gu, initcapWord)),
  REVERSE: ([a]) => textOrBlank([...dstr(a!)].reverse().join("")),
  ASCII: ([a]) => {
    const s = dstr(a!);
    return s === "" ? blank("Number") : num(s.charCodeAt(0));
  },
  CHR: ([a]) => {
    const code = toInt(a!);
    return code > 0 ? text(String.fromCodePoint(code)) : blank("Text");
  },
  TEXT: ([a]) => text(concatString(a!)),
  VALUE: ([a]) => {
    const s = dstr(a!).trim();
    return isParsableNumber(s)
      ? num(new Decimal(s))
      : error("#Error! (VALUE: not a number)");
  },

  // Math
  ABS: ([a]) => num(dnum(a!).abs()),
  ROUND: ([a, digits]) => num(roundTo(dnum(a!), toInt(digits!))),
  // Salesforce FLOOR/CEILING round relative to zero, not ±∞: FLOOR truncates
  // toward zero (FLOOR(-1.4) = -1), CEILING rounds away from zero
  // (CEILING(-1.4) = -2). Verified against the oracle corpus.
  FLOOR: ([a]) => num(dnum(a!).toDecimalPlaces(0, Decimal.ROUND_DOWN)),
  CEILING: ([a]) => num(dnum(a!).toDecimalPlaces(0, Decimal.ROUND_UP)),
  MOD: ([a, b]) => {
    const d = dnum(b!);
    // Salesforce MOD(x, 0) is a runtime error (not x), verified against the oracle.
    return d.isZero() ? error("#Error! (MOD by zero)") : num(dnum(a!).mod(d));
  },
  SQRT: ([a]) => {
    const d = dnum(a!);
    // Salesforce computes SQRT at double precision (SQRT(2) = 1.4142135623730951).
    // `lessThan(0)` (not isNegative) so a signed -0 from FLOOR reads as 0, not an error.
    return d.lessThan(0)
      ? error("#Error! (SQRT of negative)")
      : num(new Decimal(Math.sqrt(d.toNumber())));
  },
  MAX: (args) => num(Decimal.max(...args.map(dnum))),
  MIN: (args) => num(Decimal.min(...args.map(dnum))),
  POWER: ([a, b]) => num(dnum(a!).pow(dnum(b!))),
  TRUNC: ([a, digits]) => num(truncTo(dnum(a!), digits ? toInt(digits) : 0)),
  // MFLOOR/MCEILING are the mathematical floor/ceiling (toward ∓∞), unlike
  // FLOOR/CEILING which round relative to zero. Verified against the corpus.
  MFLOOR: ([a]) => num(dnum(a!).floor()),
  MCEILING: ([a]) => num(dnum(a!).ceil()),

  // Date & time
  TODAY: (_args, env) =>
    env.now
      ? dateValue(dateFromEpoch(env.now.epochMillis))
      : error("#Error! (no clock)"),
  NOW: (_args, env) =>
    env.now ? datetimeValue(env.now.epochMillis) : error("#Error! (no clock)"),
  DATE: ([y, m, d]) => {
    const parts = { year: toInt(y!), month: toInt(m!), day: toInt(d!) };
    return isValidDate(parts)
      ? dateValue(parts)
      : error("#Error! (invalid date)");
  },
  DATEVALUE: ([a]) => parseDate(dstr(a!)),
  YEAR: ([a]) => dateField(a!, (p) => p.year),
  MONTH: ([a]) => dateField(a!, (p) => p.month),
  DAY: ([a]) => dateField(a!, (p) => p.day),
  ADDMONTHS: ([a, n]) => {
    const p = datePartsOf(a!);
    return p
      ? dateValue(addMonths(p, toInt(n!)))
      : error("#Error! (ADDMONTHS: not a date)");
  },
};

export const SPECIAL_FORMS: Record<string, SpecialForm> = {
  IF: (args, env, evaluate) => {
    if (args.length < 3) {
      return error("#Error! (IF needs 3 arguments)");
    }
    const cond = evaluate(args[0]!, env);
    if (isError(cond)) {
      return cond;
    }
    return evaluate(boolCoerce(cond) ? args[1]! : args[2]!, env);
  },
  AND: (args, env, evaluate) => {
    for (const argNode of args) {
      const v = evaluate(argNode, env);
      if (isError(v)) {
        return v;
      }
      if (!boolCoerce(v)) {
        return bool(false);
      }
    }
    return bool(true);
  },
  OR: (args, env, evaluate) => {
    for (const argNode of args) {
      const v = evaluate(argNode, env);
      if (isError(v)) {
        return v;
      }
      if (boolCoerce(v)) {
        return bool(true);
      }
    }
    return bool(false);
  },
  IFERROR: (args, env, evaluate) => {
    if (args.length < 2) {
      return error("#Error! (IFERROR needs 2 arguments)");
    }
    const v = evaluate(args[0]!, env);
    // A thrown UnsupportedError propagates (honest refusal); only a simulated
    // #Error falls back.
    return isError(v) ? evaluate(args[1]!, env) : v;
  },
  CASE: (args, env, evaluate) => {
    if (args.length < 1) {
      return error("#Error! (CASE needs arguments)");
    }
    const subject = evaluate(args[0]!, env);
    if (isError(subject)) {
      return subject;
    }
    let i = 1;
    for (; i + 1 < args.length; i += 2) {
      const when = evaluate(args[i]!, env);
      if (isError(when)) {
        return when;
      }
      if (caseEqual(subject, when)) {
        return evaluate(args[i + 1]!, env);
      }
    }
    // Trailing argument is the else value; if absent, blank.
    return i < args.length ? evaluate(args[i]!, env) : blank("Unknown");
  },
};

// --- Small helpers -------------------------------------------------------

/** Integer coercion for functions like DATE/LEFT/MID: Salesforce truncates
 * fractional arguments toward zero (DATE(2009, 3.5, 2) → March 2). */
function toInt(v: SfValue): number {
  return Math.trunc(dnum(v).toNumber());
}

/** Salesforce text functions return blank, not empty string, for an empty result. */
function textOrBlank(s: string): SfValue {
  return s === "" ? blank("Text") : text(s);
}

/** ROUND with round-half-up, supporting negative digits (round left of the point). */
function roundTo(d: Decimal, digits: number): Decimal {
  if (digits >= 0) {
    return d.toDecimalPlaces(digits);
  }
  const factor = new Decimal(10).pow(-digits);
  return d.div(factor).toDecimalPlaces(0).times(factor);
}

/** TRUNC: truncate toward zero at `digits` places (negative = left of the point). */
function truncTo(d: Decimal, digits: number): Decimal {
  if (digits >= 0) {
    return d.toDecimalPlaces(digits, Decimal.ROUND_DOWN);
  }
  const factor = new Decimal(10).pow(-digits);
  return d.div(factor).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(factor);
}

/** SUBSTR 0-based offset: 1-based positive, 0/1 → start, negative from the end. */
function substrStart(n: number, length: number): number {
  if (n > 0) {
    return n - 1;
  }
  return n === 0 ? 0 : length + n;
}

/** INITCAP word transform: first letter upper, remainder lower. */
function initcapWord(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function isParsableNumber(s: string): boolean {
  if (s.trim() === "") {
    return false;
  }
  try {
    void new Decimal(s.trim());
    return true;
  } catch {
    return false;
  }
}

function caseEqual(a: SfValue, b: SfValue): boolean {
  if (a.blank || b.blank) {
    return a.blank && b.blank;
  }
  if (!a.blank && !b.blank && a.type === "Boolean" && b.type === "Boolean") {
    return a.data === b.data;
  }
  if (
    (a.type === "Number" || a.type === "Currency" || a.type === "Percent") &&
    !b.blank
  ) {
    return asDecimal(a).equals(dnum(b));
  }
  return concatString(a) === concatString(b);
}

function datePartsOf(v: SfValue): DateParts | null {
  if (v.blank) {
    return null;
  }
  if (v.type === "Date") {
    return v.data;
  }
  if (v.type === "Datetime") {
    return dateFromEpoch(v.data.epochMillis);
  }
  return null;
}

function dateField(v: SfValue, pick: (p: DateParts) => number): EvalResult {
  const p = datePartsOf(v);
  return p ? num(pick(p)) : error("#Error! (expected a date)");
}

function parseDate(s: string): EvalResult {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s.trim());
  if (!m) {
    return error("#Error! (DATEVALUE: cannot parse)");
  }
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidDate(parts)
    ? dateValue(parts)
    : error("#Error! (DATEVALUE: invalid date)");
}

function addMonths(p: DateParts, n: number): DateParts {
  const total = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  // Clamp the day to the target month's length (Salesforce month-end behavior).
  const day = Math.min(p.day, daysInMonth(year, month));
  return { year, month, day };
}
