import {
  assertNever,
  type BinaryOp,
  type Expr,
  type FunctionCall,
} from "../syntax/index.ts";
import { CONTEXTS, getFunction } from "../registry/index.ts";
import {
  asDecimal,
  asText,
  blank,
  bool,
  dateValue,
  datetimeValue,
  timeValue,
  Decimal,
  error,
  isError,
  num,
  text,
  UnsupportedError,
  type BlankMode,
  type DateParts,
  type DatetimeVal,
  type EvalResult,
  type SfValue,
} from "./value.ts";
import {
  BUILTINS,
  SPECIAL_FORMS,
  boolCoerce,
  concatString,
  dateFromEpoch,
  epochOfDate,
  isFoldedNumericLiteral,
  isValidDate,
  isValidEpochMs,
} from "./builtins.ts";

export interface EvalEnv {
  readonly fields: ReadonlyMap<string, SfValue>;
  readonly blankMode: BlankMode;
  /** Clock for TODAY()/NOW(); required for those functions to simulate. */
  readonly now?: DatetimeVal;
}

/**
 * Evaluate a formula AST over the Salesforce value domain (DESIGN §7).
 *
 * Returns an `SfValue` or a `FormulaError` (Salesforce's `#Error!`). Throws
 * `UnsupportedError` when the formula uses a construct outside the supported
 * simulation subset — an honest refusal, never a guess. Unexpected
 * type mishaps degrade to `#Error!` rather than crashing the editor.
 */
export function evaluateFormula(ast: Expr, env: EvalEnv): EvalResult {
  try {
    const r = evaluate(ast, env);
    // Materialize the final Number to Salesforce's 32-place display scale.
    return isError(r) ? r : materialize(r);
  } catch (e) {
    if (e instanceof UnsupportedError) {
      throw e;
    }
    return error("#Error!");
  }
}

// Salesforce carries 39 significant figures through chained `/` and `*` (see
// value.ts) and rounds HALF_UP to this many decimal places only when a Number is
// "materialized": the final result and each value handed to a function or
// comparison. Never round per-operation — that loses the guard digits and
// FLOOR((1/9)*9) becomes 0 instead of 1. Oracle-verified.
const MAX_SCALE = 32;

function materialize(v: SfValue): SfValue {
  if (v.blank || !isNumericType(v)) {
    return v;
  }
  return { ...v, data: v.data.toDecimalPlaces(MAX_SCALE) };
}

// Global roots the registry marks non-simulatable in any context ($Setup,
// $CustomMetadata, $Permission, $Label, $System, $Api) — lowercased for the
// case-insensitive reference match.
const ORG_STATE_GLOBAL_ROOTS = new Set(
  CONTEXTS.flatMap((c) => c.globals)
    .filter((g) => !g.simulatable)
    .map((g) => g.name.toLowerCase()),
);

function evaluate(node: Expr, env: EvalEnv): EvalResult {
  switch (node.kind) {
    case "NumberLit":
      return num(node.raw);
    case "StringLit":
      return text(node.value);
    case "BooleanLit":
      return bool(node.value);
    case "NullLit":
      return blank("Unknown");
    case "ErrorNode":
      return error("#Error! (cannot evaluate invalid formula)");
    case "FieldRef": {
      const key = node.path.join(".");
      // $System.originDateTime is a fixed constant — 1900-01-01 00:00:00 GMT
      // (org-verified, corpus:testOriginDateTime).
      if (key.toLowerCase() === "$system.origindatetime") {
        return datetimeValue(Date.UTC(1900, 0, 1));
      }
      // Org-state globals ($Setup, $CustomMetadata, $Api…) resolve to org
      // data we cannot know — refuse rather than read as blank (rule 1). An
      // explicitly supplied value still wins (it is user input, not a guess).
      if (
        node.path[0]?.startsWith("$") &&
        !env.fields.has(key) &&
        ORG_STATE_GLOBAL_ROOTS.has(node.path[0].toLowerCase())
      ) {
        throw new UnsupportedError(node.path[0]);
      }
      const v = env.fields.get(key) ?? blank("Unknown");
      // "Treat blank fields as zeroes" mode: an empty Number/Currency/Percent
      // field reads as a real 0 everywhere it is used — arithmetic, ISNULL,
      // NULLVALUE — not as blank. Verified against the oracle corpus.
      if (env.blankMode === "zero" && v.blank && isNumericType(v)) {
        return { ...v, blank: false, data: new Decimal(0) };
      }
      return v;
    }
    case "Paren":
      return evaluate(node.expr, env);
    case "UnaryOp": {
      const operand = evaluate(node.operand, env);
      if (isError(operand)) {
        return operand;
      }
      // Blank propagates through unary sign in blank mode; zero mode reads the
      // blank as 0 (org-verified, semantics:unary_minus_blank).
      if (operand.blank && env.blankMode === "blank") {
        return blank("Number");
      }
      const d = toDecimal(operand);
      return node.op === "-" ? num(d.negated()) : num(d);
    }
    case "BinaryOp":
      return evalBinary(node, env);
    case "FunctionCall":
      return evalCall(node, env);
    default:
      return assertNever(node);
  }
}

/**
 * Coerce a value to a Decimal. Blank-mode propagation happens in the callers
 * (arithmetic, compare, and unary minus bail out first), so any blank that
 * reaches here reads as 0 in both modes.
 */
function toDecimal(v: SfValue): Decimal {
  return v.blank ? new Decimal(0) : asDecimal(v);
}

function isNumericType(v: SfValue): v is Extract<SfValue, { data: Decimal }> {
  return v.type === "Number" || v.type === "Currency" || v.type === "Percent";
}

function isDatelike(v: SfValue): boolean {
  return v.type === "Date" || v.type === "Datetime" || v.type === "Time";
}

function evalBinary(node: BinaryOp, env: EvalEnv): EvalResult {
  // `&&`/`||` mirror AND()/OR(): blank coerces to false and evaluation
  // short-circuits left-to-right, so they bypass the eager operand evaluation
  // below.
  if (node.op === "&&" || node.op === "||") {
    const cond = evaluate(node.left, env);
    if (isError(cond)) {
      return cond;
    }
    const lb = boolCoerce(cond);
    if (node.op === "&&" ? !lb : lb) {
      return bool(node.op === "||");
    }
    const rest = evaluate(node.right, env);
    if (isError(rest)) {
      return rest;
    }
    return bool(boolCoerce(rest));
  }

  const l = evaluate(node.left, env);
  if (isError(l)) {
    return l;
  }
  const r = evaluate(node.right, env);
  if (isError(r)) {
    return r;
  }

  switch (node.op) {
    case "&":
      // Materialize numeric operands so a concatenated Number shows 32 places.
      return normalizeEmptyText(
        text(concatString(materialize(l)) + concatString(materialize(r))),
      );
    case "+":
      // Salesforce '+' concatenates when both operands are text. A single blank
      // operand absorbs to "" like '&', but blank + blank stays null
      // (org-verified, testAddConcatSimple#2–#4).
      if (isTextType(l) && isTextType(r)) {
        if (l.blank && r.blank) {
          return blank("Text");
        }
        return normalizeEmptyText(text(concatString(l) + concatString(r)));
      }
      return arithmetic(node.op, l, r, env);
    case "-":
    case "*":
    case "/":
      return arithmetic(node.op, l, r, env);
    case "^":
      // The org computes literal-only `^` in a distinct compile-time path
      // (see powProduct); foldedness is a property of the AST, not the values.
      return arithmetic(node.op, l, r, env, isFoldedNumericLiteral(node));
    case "=":
    case "==": {
      const eq = tryEqual(l, r);
      return eq === null ? blank("Boolean") : bool(eq);
    }
    case "<>":
    case "!=": {
      const eq = tryEqual(l, r);
      // A null equality (blank numeric operand) propagates: `<>` is not simply
      // the negation of `=` here — both are unknown, hence false in context.
      return eq === null ? blank("Boolean") : bool(!eq);
    }
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(node.op, l, r);
    default:
      return assertNever(node.op);
  }
}

function arithmetic(
  op: "+" | "-" | "*" | "/" | "^",
  l: SfValue,
  r: SfValue,
  env: EvalEnv,
  foldedPow = false,
): EvalResult {
  // A blank operand in date-family arithmetic nulls the result in BOTH
  // modes — the "blanks as zeroes" coercion is numeric-only (org-verified,
  // testAddDate#0 [zero]). This covers a typeless blank meeting a temporal
  // (e.g. TIMEVALUE(blank) − TIMEVALUE(t), testSubtractTwoTimeFields).
  if ((isDatelike(l) || isDatelike(r)) && (l.blank || r.blank)) {
    return blank(isDatelike(l) ? l.type : r.type);
  }
  // In "blank" mode, a blank operand makes the whole result blank. This
  // includes typeless blanks (a NULL literal, an unsupplied field, a CASE
  // fallthrough), matching the UnaryOp branch — a typed and a typeless blank
  // must not diverge (VERIFICATION.md, blank propagation).
  if (env.blankMode === "blank" && (l.blank || r.blank)) {
    return blank("Number");
  }
  if (isDatelike(l) || isDatelike(r)) {
    return temporalArithmetic(op, l, r);
  }
  const a = toDecimal(l);
  const b = toDecimal(r);
  // Results carry decimal.js's 39-sig-fig precision (value.ts); they are rounded
  // to 32 places only at materialization, never per operation.
  switch (op) {
    case "+":
      return num(a.plus(b));
    case "-":
      return num(a.minus(b));
    case "*":
      return num(a.times(b));
    case "/":
      if (b.isZero()) {
        return error("#Error! (division by zero)");
      }
      return num(a.div(b));
    case "^":
      // Salesforce's `^` rejects non-integer exponents (use SQRT for roots).
      if (!b.isInteger()) {
        return error("#Error! (^ requires an integer exponent)");
      }
      return powProduct(a, b, foldedPow);
    default:
      return assertNever(op);
  }
}

/**
 * `^` per the org. The operator has TWO org-side code paths, split by
 * whether the compiler constant-folds it (both operands numeric literals —
 * see isFoldedNumericLiteral):
 *
 * FOLDED, b ≥ 0: the exact value rounded to 18 SIGNIFICANT digits, HALF_UP —
 * digit-exact across sixteen probes (3^34 exact at 17 digits, which no IEEE
 * double can produce; the pw5_dbl/pw6_clamp/pw7_clamp/pw8_flush series).
 * Nothing is ever tail-truncated (0.5^76 keeps all 18 digits through place 40): a
 * folded value is kept whole unless it rounds to zero at 39 decimal
 * places, in which case it FLUSHES to zero — every kept row down to
 * 0.5^129 ≈ 1.5e-39 renders in full and every flushed row is below 5e-40
 * (pw8_flush bisect; pw8b boundary probes at 0.5^130/131 straddle the
 * line itself).
 *
 * RUNTIME (one field operand suffices, pw6_rt_mixed) and every negative
 * exponent in either path: decimal at SCALE 42, HALF_UP — field-valued
 * 0.7^80 / 0.5^132 / 3^-25 and literal 3^-25 / 7^-20 / 9^-30 are all
 * digit-exact at place 42, field-valued 3^40 returns the exact integer
 * (pw6_rt_int) where the folded form rounds to …800, and (1e-13)^1000 → 0
 * falls out of the scale (#20). EXACT results are limited to 43
 * significant digits: #18 (43 sigs at scale 42) computes while 7^52 / 7^53
 * / 7^54 / 7^55 (44–47 digits) are runtime errors (pw7_rt_bigsig,
 * pw8_prec_* bisect). Non-terminating values escape the limit by rounding:
 * field-valued 0.3^-5 needs 45 places-worth of digits yet computes,
 * rendering as the TEXT 39-sig budget over a rounded carry
 * (pw8_recip_rt_nonterm). Terminating reciprocals behave like positive
 * exponents (0.5^-10 = 1024 in both paths, pw8_recip_*_dyadic) and go
 * through the same exact path.
 *
 * CAP: |result| > 1e64 is a runtime #Error! in both paths and both
 * exponent signs (literal owb/owb2/owc bisects; field-valued 10^80,
 * pw6_rt_cap; the 0.1^-70 reciprocal, pw7_recip_cap). 0^negative is a
 * runtime #Error!, not blank (pw6_zeroneg_blank: ISBLANK over it errors
 * the whole formula), matching the reciprocal's division by zero. 0^0 = 1
 * in both paths (pw5_zero_zero, testExponentiationOperator#1–#3).
 */
const POW_CAP = new Decimal("1e64");
const POW_SCALE = 42;
// A folded result flushes to zero when its first significant digit sits
// beyond place 39 — truncation, not rounding: 0.5^130 ≈ 7.35e-40 flushes
// even though it would round up to 1e-39, while 0.5^129 ≈ 1.47e-39 keeps
// all 18 digits (pw8b straddle).
const POW_FOLD_FLUSH = new Decimal("1e-39");
// Exact runtime results carry at most 43 significant digits (pw8_prec
// bisect: 43 computes, 44 errors).
const POW_EXACT_SIG_LIMIT = 43;

function powProduct(a: Decimal, b: Decimal, folded: boolean): EvalResult {
  const raw = a.pow(b);
  if (!raw.isFinite()) {
    return error("#Error! (division by zero)");
  }
  if (folded && !b.isNegative()) {
    const sig = raw.toSignificantDigits(18, Decimal.ROUND_HALF_UP);
    if (sig.abs().greaterThan(POW_CAP)) {
      return error("#Error! (^ result exceeds 1e64)");
    }
    if (sig.abs().lessThan(POW_FOLD_FLUSH)) {
      return num(0);
    }
    return num(sig);
  }
  if (raw.abs().greaterThan(POW_CAP)) {
    return error("#Error! (^ result exceeds 1e64)");
  }
  // Values below 10 fit scale 42 inside the 43-digit budget by
  // construction. Larger values may not, and decimal.js's rounded 40-sig
  // carry cannot even measure their true significance — so they go through
  // an exact BigInt path (terminating values) or round like the org does
  // (non-terminating reciprocals).
  if (raw.e >= 1) {
    const exact = exactPow(a, b);
    if (exact === "nonterminating") {
      // The org rounds non-terminating reciprocals on a 40-plus-digit carry
      // rather than erroring (0.3^-5 through 0.3^-72 compute digit-exactly
      // against a >=40-sig rounding), up to a magnitude line at 1e38:
      // 38 integer digits compute and 39 error — adjacent pw8c/pw8d probes,
      // Oracle NUMBER's precision-38 ceiling showing through.
      if (raw.e >= 38) {
        return error("#Error! (^ result exceeds the numeric precision limit)");
      }
      return num(raw);
    }
    if (exact === null) {
      throw new UnsupportedError("^");
    }
    const scaled = exact.toDecimalPlaces(POW_SCALE, Decimal.ROUND_HALF_UP);
    const sigCount = scaled.isZero() ? 0 : scaled.precision();
    if (sigCount > POW_EXACT_SIG_LIMIT) {
      return error("#Error! (^ result exceeds the numeric precision limit)");
    }
    return num(scaled);
  }
  return num(raw.toDecimalPlaces(POW_SCALE, Decimal.ROUND_HALF_UP));
}

/**
 * Exact a^b as an unrounded Decimal (the constructor does not round; only
 * operations do). Negative exponents are exact when the reciprocal
 * terminates — the base's significand has no prime factors beyond 2 and 5;
 * "nonterminating" reports the (infinite) cases the org rounds instead.
 * Null means the exact form is unreasonably large to compute, so the true
 * significance cannot be verified at all.
 */
function exactPow(a: Decimal, b: Decimal): Decimal | "nonterminating" | null {
  const fixed = a.toFixed();
  const neg = fixed.startsWith("-");
  const digitStr = (neg ? fixed.slice(1) : fixed).replace(".", "");
  const k = a.decimalPlaces();
  const m = Math.abs(b.toNumber());
  if (m > 5000 || k * m > 10_000) {
    return null;
  }
  const sign = neg && m % 2 === 1 ? "-" : "";
  if (!b.isNegative()) {
    const n = BigInt(digitStr) ** BigInt(m);
    return decimalFromScaled(sign, n, k * m);
  }
  // a^-m = 10^(k·m) / n^m, terminating iff n = 2^i · 5^j.
  let n = BigInt(digitStr);
  let twos = 0;
  let fives = 0;
  while (n % 2n === 0n) {
    n /= 2n;
    twos += 1;
  }
  while (n % 5n === 0n) {
    n /= 5n;
    fives += 1;
  }
  if (n !== 1n) {
    return "nonterminating";
  }
  const extra = m * Math.max(twos, fives);
  if (k * m + extra > 10_000) {
    return null;
  }
  const denom = BigInt(digitStr) ** BigInt(m);
  const scaled = 10n ** BigInt(k * m + extra) / denom;
  return decimalFromScaled(sign, scaled, extra);
}

function decimalFromScaled(sign: string, n: bigint, scale: number): Decimal {
  let s = n.toString();
  if (scale === 0) {
    return new Decimal(sign + s);
  }
  if (s.length <= scale) {
    s = "0".repeat(scale - s.length + 1) + s;
  }
  return new Decimal(
    `${sign}${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`,
  );
}

const DAY_MS = 86_400_000;

/**
 * Date/datetime/time arithmetic, corpus-verified (testAddDate, testAddDateTime,
 * testSubDateTime, testAddTimeValue*, testSubtractTimeValue*,
 * testSubtractTwoTimeFields):
 *   date ± n      → date, with n truncated toward zero (28 + 3.5 → Mar 2)
 *   date − date   → whole days
 *   datetime ± n  → datetime, n in fractional days at millisecond resolution
 *   dt − dt       → fractional days (1.375)
 *   time + n      → time, n in milliseconds, wrapping midnight (+26h ≡ +2h)
 *   time − n      → time, but out-of-range is a runtime error, not a wrap
 *   time − time   → milliseconds
 * Anything else (reversed number-first operands, cross-family mixes) has no
 * corpus row and stays a simulated error rather than a guess.
 */
function temporalArithmetic(
  op: "+" | "-" | "*" | "/" | "^",
  l: SfValue,
  r: SfValue,
): EvalResult {
  const unsupportedMix = error(
    `#Error! (unsupported ${l.type} ${op} ${r.type})`,
  );
  if (op !== "+" && op !== "-") {
    return unsupportedMix;
  }
  const sign = op === "+" ? 1 : -1;
  if (l.type === "Date" && isNumericType(r)) {
    const days = toDecimal(r).truncated().toNumber();
    const epoch = epochOfDate(asDate(l)) + sign * days * DAY_MS;
    // Out-of-range results must surface as a simulated error — new Date()
    // would otherwise yield NaN parts or years past 9999 that DATE() itself
    // rejects. The exact product boundary is unverified (VERIFICATION.md).
    if (!Number.isFinite(epoch) || !isValidDate(dateFromEpoch(epoch))) {
      return error("#Error! (date out of range)");
    }
    return dateValue(dateFromEpoch(epoch));
  }
  if (l.type === "Date" && r.type === "Date" && op === "-") {
    return num((epochOfDate(asDate(l)) - epochOfDate(asDate(r))) / DAY_MS);
  }
  if (l.type === "Datetime" && isNumericType(r)) {
    const deltaMs = toDecimal(r).times(DAY_MS).toNumber();
    const ms = asDatetimeMs(l) + sign * Math.round(deltaMs);
    if (!isValidEpochMs(ms)) {
      return error("#Error! (datetime out of range)");
    }
    return datetimeValue(ms);
  }
  if (l.type === "Datetime" && r.type === "Datetime" && op === "-") {
    return num(new Decimal(asDatetimeMs(l) - asDatetimeMs(r)).div(DAY_MS));
  }
  if (l.type === "Time" && isNumericType(r)) {
    // Milliseconds; a result past midnight wraps (10:34 + 26h ≡ 12:34,
    // testAddBigTimeValue) but a negative one is a runtime error
    // (testSubtractBigTimeValue, testAddHoursWithTwoCustFields).
    const delta = toDecimal(r).truncated().toNumber();
    const raw = asTimeMs(l) + sign * delta;
    return raw < 0
      ? error("#Error! (time out of range)")
      : timeValue(raw % DAY_MS);
  }
  if (l.type === "Time" && r.type === "Time" && op === "-") {
    // A negative difference wraps forward a day (testSubtractTwoTimeFields:
    // earlier − later = 24h − gap, never negative).
    const diff = asTimeMs(l) - asTimeMs(r);
    return num(((diff % DAY_MS) + DAY_MS) % DAY_MS);
  }
  return unsupportedMix;
}

function asDate(v: SfValue): DateParts {
  if (v.type !== "Date") {
    throw new Error(`Expected a date, got ${v.type}`);
  }
  return v.data;
}

function asDatetimeMs(v: SfValue): number {
  if (v.type !== "Datetime") {
    throw new Error(`Expected a datetime, got ${v.type}`);
  }
  return v.data.epochMillis;
}

function asTimeMs(v: SfValue): number {
  if (v.type !== "Time") {
    throw new Error(`Expected a time, got ${v.type}`);
  }
  return v.data.millisOfDay;
}

/**
 * Three-valued equality under Salesforce blank semantics. Returns `null` when
 * the result is unknown (a blank numeric operand), which the caller renders as a
 * blank Boolean — false in a boolean context. Text comparison coerces blank to
 * the empty string, so `blankText = "" ` is true.
 */
function tryEqual(l: SfValue, r: SfValue): boolean | null {
  // Text equality is case-sensitive (oracle-verified) and treats a blank field
  // as the empty string.
  if (isTextType(l) && isTextType(r)) {
    return concatString(l) === concatString(r);
  }
  if (l.blank || r.blank) {
    return null;
  }
  if (isNumericType(l) && isNumericType(r)) {
    // Compare at the 32-place materialized scale (so (1/9)*9 equals 1).
    return asDecimal(materialize(l)).equals(asDecimal(materialize(r)));
  }
  if (l.type === "Boolean" && r.type === "Boolean") {
    return l.data === r.data;
  }
  const lt = temporalMillis(l);
  const rt = temporalMillis(r);
  if (lt !== null && rt !== null && l.type === r.type) {
    return lt === rt;
  }
  return false;
}

/** A comparable instant for same-type temporal comparison, or null. */
function temporalMillis(v: SfValue): number | null {
  if (v.blank) {
    return null;
  }
  switch (v.type) {
    case "Date":
      return epochOfDate(v.data);
    case "Datetime":
      return v.data.epochMillis;
    case "Time":
      return v.data.millisOfDay;
    default:
      return null;
  }
}

function isTextType(v: SfValue): boolean {
  return (
    v.type === "Text" ||
    v.type === "Id" ||
    v.type === "Picklist" ||
    v.type === "Multipicklist"
  );
}

/**
 * The org's value domain has no empty-text state distinct from blank: every
 * text-producing operation that comes out empty reads back as blank and
 * ISBLANK sees blank (org-verified, pw8_be_* riders — including "" & "",
 * TRIM(" "), UPPER("") and SUBSTITUTE deleting everything). Operation
 * results normalize accordingly. A bare "" literal is left as-is — the two
 * states are indistinguishable anyway (ISBLANK("") is true and blank text
 * compares as "").
 */
function normalizeEmptyText(v: EvalResult): EvalResult {
  if (!isError(v) && !v.blank && isTextType(v) && asText(v) === "") {
    return blank(v.type);
  }
  return v;
}

function strcmp(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compare(
  op: "<" | "<=" | ">" | ">=",
  l: SfValue,
  r: SfValue,
): EvalResult {
  // An ordering comparison against a blank operand is false (blank mode). In zero
  // mode blank numerics already read as 0 upstream, so this only fires for values
  // that remain blank. Verified against the oracle corpus.
  if (l.blank || r.blank) {
    return bool(false);
  }
  let cmp: number;
  const lt = temporalMillis(l);
  const rt = temporalMillis(r);
  if (isTextType(l) && isTextType(r)) {
    cmp = strcmp(asText(l), asText(r));
  } else if (lt !== null && rt !== null && l.type === r.type) {
    cmp = Math.sign(lt - rt);
  } else {
    // Order at the 32-place materialized scale, consistent with equality.
    cmp = toDecimal(materialize(l)).comparedTo(toDecimal(materialize(r)));
  }
  switch (op) {
    case "<":
      return bool(cmp < 0);
    case "<=":
      return bool(cmp <= 0);
    case ">":
      return bool(cmp > 0);
    case ">=":
      return bool(cmp >= 0);
    default:
      return assertNever(op);
  }
}

// Functions that must observe blank inputs rather than propagate them to null.
const BLANK_AWARE = new Set([
  "ISBLANK",
  "ISNULL",
  "ISNUMBER",
  "ISPICKVAL",
  // Blank multi-select: INCLUDES is false, PICKLISTCOUNT is 0 (org-verified).
  "INCLUDES",
  "PICKLISTCOUNT",
  // Handles blanks per-argument: a blank operand nulls but a blank
  // includeDays checkbox reads false (corpus, testFormatDurationSecondsBool).
  "FORMATDURATION",
  "NULLVALUE",
  "BLANKVALUE",
  "LEN",
  "CONCATENATE",
  "TEXT",
  // UPPER/LOWER/INITCAP absorb a blank to "" (unlike TRIM, which propagates).
  "UPPER",
  "LOWER",
  "INITCAP",
  // Per-argument: blank source propagates (handled in the builtin), blank
  // search/replacement absorb (org-verified, testSimpleSubstitute).
  "SUBSTITUTE",
  // Blank operands coerce to "" (org- and oracle-verified: CONTAINS(x, blank)
  // is true, CONTAINS(blank, y) is false, FIND(y, blank) is 0).
  "CONTAINS",
  "FIND",
]);

function evalCall(node: FunctionCall, env: EvalEnv): EvalResult {
  const spec = getFunction(node.callee);
  if (!spec) {
    return error(`#Error! (unknown function ${node.callee})`);
  }
  if (!spec.simulatable) {
    throw new UnsupportedError(spec.name);
  }

  const special = SPECIAL_FORMS[spec.name];
  if (special) {
    return normalizeEmptyText(special(node.args, env, evaluate));
  }

  const args: SfValue[] = [];
  for (const argNode of node.args) {
    const v = evaluate(argNode, env);
    if (isError(v)) {
      return v;
    }
    // A Number handed to a function is materialized to 32 places, so e.g.
    // FLOOR((1/9)*9) sees 1, not 0.999…. Oracle-verified.
    args.push(materialize(v));
  }

  // A blank argument makes most functions blank (null propagates) — in both
  // blank modes, since "treat blanks as zeroes" is a numeric-only, read-time
  // coercion (see FieldRef) that stops numerics from ever reaching here blank.
  // The exceptions inspect or absorb blankness themselves (ISBLANK, NULLVALUE,
  // LEN → 0, concatenation and UPPER/LOWER → ""). The propagated blank
  // carries the function's declared return type so downstream blank rules
  // still apply: a blank from a Text function concatenates through `+` and
  // compares as "" (org-verified text-blank semantics), where an untyped
  // blank would fall into numeric arithmetic and error.
  if (!BLANK_AWARE.has(spec.name) && args.some((a) => a.blank)) {
    const rule = spec.returnType;
    if (rule.kind === "fixed") {
      return blank(rule.type);
    }
    return blank(args[rule.index]?.type ?? "Unknown");
  }

  const impl = BUILTINS[spec.name];
  if (!impl) {
    throw new UnsupportedError(spec.name);
  }
  return normalizeEmptyText(impl(args, env));
}
