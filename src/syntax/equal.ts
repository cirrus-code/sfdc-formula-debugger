import { assertNever, type Expr } from "./ast.ts";

/**
 * Structural equality of two ASTs, ignoring trivia: spans, attached comments,
 * and the source-level case of keyword literals are not compared. This is the
 * equivalence the formatter's reparse-equality property is stated against,
 * and the invariant the simplifier's rewrites preserve.
 *
 * Function-name and field-name case ARE compared — the formatter preserves them
 * verbatim, so a case change would be a real structural change, not trivia.
 */
export function astEqual(a: Expr, b: Expr): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "NumberLit":
      return a.raw === (b as typeof a).raw;
    case "StringLit":
      return a.value === (b as typeof a).value;
    case "BooleanLit":
      return a.value === (b as typeof a).value;
    case "NullLit":
    case "ErrorNode":
      return true;
    case "FieldRef": {
      const o = b as typeof a;
      return (
        a.isGlobal === o.isGlobal &&
        a.path.length === o.path.length &&
        a.path.every((seg, i) => seg === o.path[i])
      );
    }
    case "FunctionCall": {
      const o = b as typeof a;
      return (
        a.callee === o.callee &&
        a.args.length === o.args.length &&
        a.args.every((arg, i) => astEqual(arg, o.args[i]!))
      );
    }
    case "BinaryOp": {
      const o = b as typeof a;
      return (
        a.op === o.op && astEqual(a.left, o.left) && astEqual(a.right, o.right)
      );
    }
    case "UnaryOp": {
      const o = b as typeof a;
      return a.op === o.op && astEqual(a.operand, o.operand);
    }
    case "Paren":
      return astEqual(a.expr, (b as typeof a).expr);
    default:
      return assertNever(a);
  }
}
