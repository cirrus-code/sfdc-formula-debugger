import { assertNever, type BinaryOp, type Expr, type FunctionCall } from "../syntax/index.ts";
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
    return evaluate(ast, env);
  } catch (e) {
    if (e instanceof UnsupportedError) {throw e;}
    return error("#Error!");
  }
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
    case "FieldRef":
      return env.fields.get(node.path.join(".")) ?? blank("Unknown");
    case "Paren":
      return evaluate(node.expr, env);
    case "UnaryOp": {
      const operand = evaluate(node.operand, env);
      if (isError(operand)) {return operand;}
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
    if (env.blankMode === "zero") {return new Decimal(0);}
    // Signal "blank" via a sentinel the callers check through isBlankNumber.
    return new Decimal(0);
  }
  return asDecimal(v);
}

function isNumericType(v: SfValue): boolean {
  return v.type === "Number" || v.type === "Currency" || v.type === "Percent";
}

function evalBinary(node: BinaryOp, env: EvalEnv): EvalResult {
  const l = evaluate(node.left, env);
  if (isError(l)) {return l;}
  const r = evaluate(node.right, env);
  if (isError(r)) {return r;}

  switch (node.op) {
    case "&":
      return text(concatString(l) + concatString(r));
    case "+":
    case "-":
    case "*":
    case "/":
    case "^":
      return arithmetic(node.op, l, r, env);
    case "=":
    case "==":
      return bool(valuesEqual(l, r));
    case "<>":
    case "!=":
      return bool(!valuesEqual(l, r));
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(node.op, l, r, env);
    default:
      return assertNever(node.op);
  }
}

function arithmetic(op: "+" | "-" | "*" | "/" | "^", l: SfValue, r: SfValue, env: EvalEnv): EvalResult {
  // In "blank" mode, a blank numeric operand makes the whole result blank.
  if (env.blankMode === "blank" && ((isNumericType(l) && l.blank) || (isNumericType(r) && r.blank))) {
    return blank("Number");
  }
  const a = toDecimal(l, env);
  const b = toDecimal(r, env);
  switch (op) {
    case "+":
      return num(a.plus(b));
    case "-":
      return num(a.minus(b));
    case "*":
      return num(a.times(b));
    case "/":
      if (b.isZero()) {return error("#Error! (division by zero)");}
      return num(a.div(b));
    case "^":
      return num(a.pow(b));
    default:
      return assertNever(op);
  }
}

function valuesEqual(l: SfValue, r: SfValue): boolean {
  if (l.blank || r.blank) {return l.blank && r.blank;}
  if (isNumericType(l) && isNumericType(r)) {return asDecimal(l).equals(asDecimal(r));}
  if (l.type === "Boolean" && r.type === "Boolean") {return l.data === r.data;}
  // Text equality is currently case-sensitive; case-sensitivity of `=`/`<>` is a
  // NEEDS-VERIFICATION item (VERIFICATION.md) to be settled by the oracle corpus.
  if (isTextType(l) && isTextType(r)) {return asText(l) === asText(r);}
  return false;
}

function isTextType(v: SfValue): boolean {
  return v.type === "Text" || v.type === "Id" || v.type === "Picklist" || v.type === "Multipicklist";
}

function strcmp(a: string, b: string): number {
  if (a < b) {return -1;}
  if (a > b) {return 1;}
  return 0;
}

function compare(op: "<" | "<=" | ">" | ">=", l: SfValue, r: SfValue, env: EvalEnv): EvalResult {
  let cmp: number;
  if (isTextType(l) && isTextType(r) && !l.blank && !r.blank) {
    cmp = strcmp(asText(l), asText(r));
  } else {
    cmp = toDecimal(l, env).comparedTo(toDecimal(r, env));
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

function evalCall(node: FunctionCall, env: EvalEnv): EvalResult {
  const spec = getFunction(node.callee);
  if (!spec) {return error(`#Error! (unknown function ${node.callee})`);}
  if (!spec.simulatable) {throw new UnsupportedError(spec.name);}

  const special = SPECIAL_FORMS[spec.name];
  if (special) {return special(node.args, env, evaluate);}

  const args: SfValue[] = [];
  for (const argNode of node.args) {
    const v = evaluate(argNode, env);
    if (isError(v)) {return v;}
    args.push(v);
  }

  const impl = BUILTINS[spec.name];
  if (!impl) {throw new UnsupportedError(spec.name);}
  return impl(args, env);
}
