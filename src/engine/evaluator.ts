import {
  assertNever,
  type BinaryOp,
  type Expr,
  type FunctionCall,
} from "../syntax/index.ts";
import { getFunction } from "../registry/index.ts";
import {
  asDecimal,
  asText,
  blank,
  bool,
  Decimal,
  error,
  isError,
  num,
  text,
  UnsupportedError,
  type BlankMode,
  type DatetimeVal,
  type EvalResult,
  type SfValue,
} from "./value.ts";
import { BUILTINS, SPECIAL_FORMS, concatString } from "./builtins.ts";

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
 * simulation subset — an honest refusal, never a guess (rule 1). Unexpected
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
      const v = env.fields.get(node.path.join(".")) ?? blank("Unknown");
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
    // Signal "blank" via a sentinel the callers check through isBlankNumber.
    return new Decimal(0);
  }
  return asDecimal(v);
}

function isNumericType(
  v: SfValue,
): v is Extract<SfValue, { data: Decimal }> {
  return v.type === "Number" || v.type === "Currency" || v.type === "Percent";
}

function evalBinary(node: BinaryOp, env: EvalEnv): EvalResult {
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
      // Salesforce '+' concatenates when both operands are text — but, unlike
      // '&', a blank operand propagates to null rather than acting as "".
      if (isTextType(l) && isTextType(r)) {
        return l.blank || r.blank ? blank("Text") : text(asText(l) + asText(r));
      }
      return arithmetic(node.op, l, r, env);
    case "-":
    case "*":
    case "/":
    case "^":
      return arithmetic(node.op, l, r, env);
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
): EvalResult {
  // In "blank" mode, a blank numeric operand makes the whole result blank.
  if (
    env.blankMode === "blank" &&
    ((isNumericType(l) && l.blank) || (isNumericType(r) && r.blank))
  ) {
    return blank("Number");
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
      return num(a.pow(b));
    default:
      return assertNever(op);
  }
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
  return false;
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
  if (isTextType(l) && isTextType(r)) {
    cmp = strcmp(asText(l), asText(r));
  } else {
    // Order at the 32-place materialized scale, consistent with equality.
    cmp = toDecimal(materialize(l), env).comparedTo(toDecimal(materialize(r), env));
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
  "NULLVALUE",
  "BLANKVALUE",
  "LEN",
  "CONCATENATE",
  "TEXT",
  // UPPER/LOWER/INITCAP absorb a blank to "" (unlike TRIM, which propagates).
  "UPPER",
  "LOWER",
  "INITCAP",
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
  // LEN → 0, concatenation and UPPER/LOWER → "").
  if (!BLANK_AWARE.has(spec.name) && args.some((a) => a.blank)) {
    return blank("Unknown");
  }

  const impl = BUILTINS[spec.name];
  if (!impl) {
    throw new UnsupportedError(spec.name);
  }
  return impl(args, env);
}
