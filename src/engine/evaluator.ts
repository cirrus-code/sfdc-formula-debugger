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
// comparison. Rounding after every operation instead (our old behavior) loses the
// guard digits, so e.g. FLOOR((1/9)*9) came out 0 rather than 1. Oracle-verified.
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
      const d = toDecimal(operand, env);
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

/** Coerce a value to a Decimal, applying blank-handling mode for blank numbers. */
function toDecimal(v: SfValue, env: EvalEnv): Decimal {
  if (v.blank) {
    if (env.blankMode === "zero") {
      return new Decimal(0);
    }
    // Blank-mode propagation happens in the callers — arithmetic and compare
    // bail out before coercing — so a blank that still reaches here (unary
    // minus, or a blank non-numeric operand) coerces to 0.
    return new Decimal(0);
  }
  return asDecimal(v);
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
      return text(concatString(materialize(l)) + concatString(materialize(r)));
    case "+":
      // Salesforce '+' concatenates when both operands are text. A single blank
      // operand absorbs to "" like '&', but blank + blank stays null
      // (org-verified, testAddConcatSimple#2–#4).
      if (isTextType(l) && isTextType(r)) {
        if (l.blank && r.blank) {
          return blank("Text");
        }
        return text(concatString(l) + concatString(r));
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
      return compare(node.op, l, r, env);
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
  // In "blank" mode, a blank numeric operand makes the whole result blank.
  if (
    env.blankMode === "blank" &&
    ((isNumericType(l) && l.blank) || (isNumericType(r) && r.blank))
  ) {
    return blank("Number");
  }
  if (isDatelike(l) || isDatelike(r)) {
    return temporalArithmetic(op, l, r, env);
  }
  const a = toDecimal(l, env);
  const b = toDecimal(r, env);
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
 * `^` per the org (wave-4/5/6 probe bisects). The operator has TWO org-side
 * code paths, split by whether the compiler constant-folds it (both operands
 * numeric literals — see isFoldedNumericLiteral):
 *
 * FOLDED, b ≥ 0: the exact value rounded to 18 SIGNIFICANT digits, HALF_UP —
 * digit-exact across twelve probes (3^34 exact at 17 digits, which no IEEE
 * double can produce; 3^39/7^25/6^30/2^90/2^100/3^40/1.5^350/0.7^80/
 * 0.23^25/0.5^73/0.5^76), refuting an earlier IEEE-double reading of 2^100
 * and 3^40. Nothing is ever tail-truncated (0.5^76 keeps all 18 digits
 * through place 40, pw7_clamp_05_76, killing a scale-clamp reading): a
 * folded value is either kept whole or FLUSHED to zero. Every flushed row
 * sits below 5e-40 — i.e. rounds to zero at 39 places (0.5^132 / 0.5^135 /
 * 0.1^41 / 0.5^200) — and every kept row is ≥ 1.32e-23 (0.5^76); the
 * bracket between is unprobed and refuses.
 *
 * RUNTIME (one field operand suffices, pw6_rt_mixed) and every negative
 * exponent in either path: decimal at SCALE 42, HALF_UP — field-valued
 * 0.7^80 / 0.5^132 / 3^-25 and literal 3^-25 / 7^-20 / 9^-30 are all
 * digit-exact at place 42, field-valued 3^40 returns the exact integer
 * (pw6_rt_int) where the folded form rounds to …800, 1.00596^240's 39
 * rendered digits are the TEXT 39-sig budget over a scale-42 value (#18),
 * and (1e-13)^1000 → 0 falls out of the scale (#20). The carry has a
 * PRECISION limit: 43 significant digits compute (#18) but field-valued
 * 7^55 (47 digits, well under the magnitude cap) is a runtime error
 * (pw7_rt_bigsig) — 44–46 digits are unprobed and refuse; ≥ 47 errors
 * under every candidate limit. Results at 10 or above take an exact BigInt
 * path so the true significance is known (negative exponents there are
 * non-terminating and refuse). Computed on decimal.js's 40-sig carry, so
 * digits past 40 significant places can double-round at the quantize
 * boundary — unobservable through the 39/40-sig TEXT budget and the
 * 32-place materialization.
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
// Verified flush/keep boundary bracket for folded deep fractions: all
// flushed rows round to zero at 39 places (< 5e-40), the smallest kept row
// is 0.5^76 ≈ 1.32e-23.
const POW_FOLD_FLUSH = new Decimal("5e-40");
const POW_FOLD_KEEP = new Decimal("1.3e-23");

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
    if (sig.abs().lessThan(POW_FOLD_KEEP)) {
      throw new UnsupportedError("^");
    }
    return num(sig);
  }
  if (raw.abs().greaterThan(POW_CAP)) {
    return error("#Error! (^ result exceeds 1e64)");
  }
  // Values below 10 need at most 1 + 42 significant digits at scale 42 —
  // inside the verified 43-digit carry. Larger values may need more than
  // decimal.js's 40-sig carry can even represent, so their true significance
  // is computed exactly (BigInt) rather than read off the rounded value.
  if (raw.e >= 1) {
    const exact = b.isNegative() ? null : exactPow(a, b.toNumber());
    if (exact === null) {
      throw new UnsupportedError("^");
    }
    const scaled = exact.toDecimalPlaces(POW_SCALE, Decimal.ROUND_HALF_UP);
    const sigCount = scaled.isZero() ? 0 : scaled.precision();
    if (sigCount >= 47) {
      return error("#Error! (^ result exceeds the numeric precision limit)");
    }
    if (sigCount > 43) {
      throw new UnsupportedError("^");
    }
    return num(scaled);
  }
  return num(raw.toDecimalPlaces(POW_SCALE, Decimal.ROUND_HALF_UP));
}

/**
 * Exact a^b for a non-negative integer exponent, as an unrounded Decimal
 * (the constructor does not round; only operations do). Null when the exact
 * form would be unreasonably large to compute — such results are far outside
 * anything org-verified anyway.
 */
function exactPow(a: Decimal, b: number): Decimal | null {
  const fixed = a.toFixed();
  const neg = fixed.startsWith("-");
  const digits = (neg ? fixed.slice(1) : fixed).replace(".", "");
  const k = a.decimalPlaces();
  if (b > 5000 || k * b > 10_000) {
    return null;
  }
  const n = BigInt(digits) ** BigInt(b);
  const scale = k * b;
  const sign = neg && b % 2 === 1 ? "-" : "";
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
  env: EvalEnv,
): EvalResult {
  const unsupportedMix = error(
    `#Error! (unsupported ${l.type} ${op} ${r.type})`,
  );
  if (op !== "+" && op !== "-") {
    return unsupportedMix;
  }
  const sign = op === "+" ? 1 : -1;
  if (l.type === "Date" && isNumericType(r)) {
    const days = toDecimal(r, env).truncated().toNumber();
    return dateValue(dateFromEpoch(epochOfDate(asDate(l)) + sign * days * DAY_MS));
  }
  if (l.type === "Date" && r.type === "Date" && op === "-") {
    return num((epochOfDate(asDate(l)) - epochOfDate(asDate(r))) / DAY_MS);
  }
  if (l.type === "Datetime" && isNumericType(r)) {
    const deltaMs = toDecimal(r, env).times(DAY_MS).toNumber();
    return datetimeValue(asDatetimeMs(l) + sign * Math.round(deltaMs));
  }
  if (l.type === "Datetime" && r.type === "Datetime" && op === "-") {
    return num(new Decimal(asDatetimeMs(l) - asDatetimeMs(r)).div(DAY_MS));
  }
  if (l.type === "Time" && isNumericType(r)) {
    // Milliseconds; a result past midnight wraps (10:34 + 26h ≡ 12:34,
    // testAddBigTimeValue) but a negative one is a runtime error
    // (testSubtractBigTimeValue, testAddHoursWithTwoCustFields).
    const delta = toDecimal(r, env).truncated().toNumber();
    const raw = asTimeMs(l) + sign * delta;
    return raw < 0 ? error("#Error! (time out of range)") : timeValue(raw % DAY_MS);
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
  env: EvalEnv,
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
    cmp = toDecimal(materialize(l), env).comparedTo(
      toDecimal(materialize(r), env),
    );
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
    return special(node.args, env, evaluate);
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
  return impl(args, env);
}
