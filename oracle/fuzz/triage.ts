/**
 * WS4 differential fuzzer — first-pass triage of a discrepancy.
 *
 * Every verdict here is a *guess* meant to route a human, never a conclusion.
 * The bucket names encode the trust order (CONFORMANCE.md): the org outranks
 * this oracle, so a difference that the oracle alone witnesses can only ever
 * become an org probe — never a golden-corpus row.
 */

import { Decimal } from "../../src/engine/index.ts";
import type { BlankMode } from "./probes.ts";

export type Bucket =
  /** Our evaluator looks wrong; reproduce, fix, and keep the case as a test. */
  | "our-bug"
  /** Open-source engine vs shipped product; settle in a real org first. */
  | "org-probe-candidate"
  /** Already-settled divergence where the org overruled the oracle. */
  | "known-divergence"
  /** The channel could not report a verdict; no information either way. */
  | "inconclusive";

export interface DiffInput {
  readonly formula: string;
  readonly blankMode: BlankMode;
  /** Oracle rendering, corpus-shaped: value, `"null"`, or `"Error: …"`. */
  readonly oracle: string;
  /** Our rendering, as `conformance.ts` describes a result. */
  readonly ours: string;
}

export interface Verdict {
  readonly bucket: Bucket;
  readonly rationale: string;
}

interface Rule {
  readonly bucket: Bucket;
  readonly rationale: string;
  readonly match: (d: DiffInput) => boolean;
}

const oracleErrored = (d: DiffInput): boolean => d.oracle.startsWith("Error:");
const oursErrored = (d: DiffInput): boolean => d.ours.startsWith("#Error(");
const oursIsValue = (d: DiffInput): boolean =>
  !oursErrored(d) && d.ours !== "blank";
const oursIsBoolean = (d: DiffInput): boolean =>
  d.ours === "true" || d.ours === "false";

/** Plain or exponential decimal; our renderer emits both spellings. */
const NUMERIC = /^-?(?:\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function toDecimal(s: string): Decimal | null {
  if (!/\d/.test(s) || !NUMERIC.test(s)) {
    return null;
  }
  try {
    return new Decimal(s);
  } catch {
    return null;
  }
}

/**
 * True when two numeric renderings are the same number seen through different
 * digit budgets — the signature of a rounding/materialization boundary rather
 * than an arithmetic disagreement. `digits` of `null` means "as many as the
 * shorter rendering carries", minus one digit of slack for its own half-up
 * rounding.
 */
function agreeToSignificantDigits(
  a: string,
  b: string,
  digits: number | null,
): boolean {
  const da = toDecimal(a);
  const db = toDecimal(b);
  if (!da || !db) {
    return false;
  }
  const shared = digits ?? Math.min(da.precision(), db.precision()) - 1;
  if (shared < 10) {
    return false;
  }
  return da.toSignificantDigits(shared).equals(db.toSignificantDigits(shared));
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

/**
 * Same text except for a differing run of digits — a longer/shorter or
 * last-digit-rounded rendering of the same embedded number. The differing
 * run may sit mid-string (a rendered number concatenated with more text),
 * so a common suffix is stripped before the digit check; requiring one
 * side's run to be a short stub keeps genuine arithmetic disagreements out.
 */
function sameButForDigitTail(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const n = commonPrefixLength(a, b);
  let s = 0;
  while (
    s < a.length - n &&
    s < b.length - n &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  ) {
    s += 1;
  }
  const midA = a.slice(n, a.length - s);
  const midB = b.slice(n, b.length - s);
  return (
    n >= 6 &&
    /^\d*$/.test(midA) &&
    /^\d*$/.test(midB) &&
    Math.min(midA.length, midB.length) <= 2
  );
}

/**
 * Recognizes an embedded number rendered by two different renderers: the
 * strings agree except that one carries the integer-part zero the product drops
 * (`.5` vs `0.5`) and a different number of trailing digits.
 */
function embeddedRenderingKin(a: string, b: string): boolean {
  return (
    sameButForDigitTail(a, b) ||
    withoutIntegerZero(a).some((x) => sameButForDigitTail(x, b)) ||
    withoutIntegerZero(b).some((x) => sameButForDigitTail(a, x))
  );
}

/** Each spelling of `s` with one `0.` shortened to `.`. */
function withoutIntegerZero(s: string): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    if (s[i] === "0" && s[i + 1] === ".") {
      out.push(s.slice(0, i) + s.slice(i + 1));
    }
  }
  return out;
}

function magnitudeAtLeast(s: string, exponent: number): boolean {
  const d = toDecimal(s);
  return (
    d !== null && d.abs().greaterThanOrEqualTo(new Decimal(10).pow(exponent))
  );
}

/** ROUND/TRUNC used anywhere in the formula with a negative `num_digits`. */
function hasNegativeDigitRounding(formula: string): boolean {
  return /\b(?:ROUND|TRUNC)\(/.test(formula) && /,\s*-\d/.test(formula);
}

const RULES: readonly Rule[] = [
  {
    bucket: "known-divergence",
    rationale:
      "`MOD(x, 0)` returns `x` in the product (org-verified, VERIFICATION.md `semantics:mod_zero`); the OSS engine raises. Org wins.",
    match: (d) =>
      d.formula.includes("MOD(") &&
      d.oracle.startsWith("Error: ArithmeticException") &&
      oursIsValue(d),
  },
  {
    bucket: "known-divergence",
    rationale:
      "Formula fields short-circuit `AND`/`OR`/`&&`/`IF` past an erroring operand (org-verified, VERIFICATION.md `ff_shortcircuit_*`); the OSS engine evaluates it.",
    match: (d) =>
      oracleErrored(d) &&
      oursIsValue(d) &&
      /&&|\bAND\(|\bOR\(|\bIF\(/.test(d.formula),
  },
  {
    bucket: "known-divergence",
    rationale:
      "Product `TEXT()` number rendering (Oracle-NUMBER 39/40 significant digits, leading zero dropped) is org-verified and deliberately unlike the oracle's 32-place materialized rendering (VERIFICATION.md, `text_*` batch).",
    match: (d) =>
      d.formula.includes("TEXT(") &&
      (agreeToSignificantDigits(d.ours, d.oracle, null) ||
        embeddedRenderingKin(d.ours, d.oracle)),
  },
  {
    bucket: "known-divergence",
    rationale:
      "`^` is org-verified to a 1e64 result cap with folded literals rounded to 18 significant digits and a scale-42 runtime path (VERIFICATION.md); the OSS engine's POWER range check and precision differ.",
    match: (d) =>
      d.formula.includes("^") &&
      // Agreement to ~15 significant digits is the fold-rounding signature.
      (agreeToSignificantDigits(d.ours, d.oracle, 15) ||
        (oursErrored(d) && magnitudeAtLeast(d.oracle, 64)) ||
        (oracleErrored(d) && magnitudeAtLeast(d.ours, 64))),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "Our `^` refused on the runtime path's 43-significant-digit exact ceiling (org-verified, pw7_rt_bigsig/pw8_prec bisects) while the oracle constant-folded the whole constant base to an 18-significant-digit value. Where the product compiler's fold boundary sits for a base computed from literals is unverified (VERIFICATION.md open questions, fold boundary) — org probe, not an evaluator change.",
    match: (d) =>
      d.formula.includes("^") &&
      oursErrored(d) &&
      d.ours.includes("precision limit") &&
      !oracleErrored(d),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "TEXT() output consumed by another text function (LEN, FIND, …): the org-verified rendering divergence (leading zero dropped, 39/40-digit budget vs the oracle's 32-place materialization) propagates into a value the rendering-kinship checks cannot connect. The oracle cannot settle a TEXT-derived measure — org probe.",
    match: (d) =>
      /\b(?:LEN|FIND|MID|LEFT|RIGHT|SUBSTITUTE|CONTAINS|BEGINS|LOWER|UPPER|TRIM|VALUE)\s*\(.*TEXT\s*\(/.test(
        d.formula,
      ) &&
      !oursErrored(d) &&
      !oracleErrored(d),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      'Blank vs empty text. The org readback channel cannot tell `""` from null, so this needs a blank-aware org probe, not an oracle verdict.',
    match: (d) =>
      (d.oracle === "null" && d.ours === "") ||
      (d.oracle === "" && d.ours === "blank"),
  },
  {
    bucket: "known-divergence",
    rationale:
      'Text `+`/`&` absorbs a blank operand in the product (org-verified `"aaaa" + blank` = `"aaaa"`, VERIFICATION.md); the oracle propagates null.',
    match: (d) =>
      d.oracle === "null" &&
      oursIsValue(d) &&
      !oursIsBoolean(d) &&
      /[+&]/.test(d.formula),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "The oracle yields blank where we produce a value — blank propagation on a construct no org probe covers. The org has already overruled the oracle twice on exactly this shape (`SUBSTITUTE` with a blank search term, text `+` blank), so this needs an org probe, not a corpus row.",
    match: (d) => d.oracle === "null" && oursIsValue(d),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      'Ordering comparison against an empty-string literal. The OSS engine yields null for it (`"" < "a"` → null), which an enclosing `AND`/`IF` then absorbs into a different result; whether the product treats `""` as blank in an ordering comparison is unverified.',
    match: (d) => /""\s*(?:<=|>=|<|>)|(?:<=|>=|<|>)\s*""/.test(d.formula),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "Negative `num_digits` in ROUND/TRUNC. The oracle is self-inconsistent here (`ROUND(14, -1)` = 10 and `ROUND(150, -2)` = 200, but `ROUND(7, -1)` = 0), so it cannot settle the rule — org probe required.",
    match: (d) => hasNegativeDigitRounding(d.formula) && !oracleErrored(d),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "Same number at different digit budgets — a materialization/rounding boundary. Oracle-only evidence; needs an org probe before anything is encoded.",
    match: (d) => agreeToSignificantDigits(d.ours, d.oracle, null),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      "The oracle raises where we compute. An OSS-only error shape has already been overruled once (`MOD(x, 0)`), so this needs an org probe.",
    match: (d) => oracleErrored(d) && oursIsValue(d),
  },
  {
    bucket: "org-probe-candidate",
    rationale:
      'The oracle raises where we propagate blank — an OSS-only error over a blank-valued expression (e.g. `VALUE("")` feeding null into a NumberFormatException). OSS-only error shapes have been overruled before (`MOD(x, 0)`), and the org readback channel can confirm blank directly — org probe.',
    match: (d) => oracleErrored(d) && d.ours === "blank",
  },
];

export function triage(d: DiffInput): Verdict {
  for (const rule of RULES) {
    if (rule.match(d)) {
      return { bucket: rule.bucket, rationale: rule.rationale };
    }
  }
  return {
    bucket: "our-bug",
    rationale: oursErrored(d)
      ? "We refuse or error where the OSS engine produces a value or blank; check the evaluator before assuming a product difference."
      : "Plain value disagreement with no recorded org overrule covering it.",
  };
}
