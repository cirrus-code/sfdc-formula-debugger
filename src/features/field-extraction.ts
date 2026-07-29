import { type Expr } from "../syntax/index.ts";
import {
  getFunction,
  type FunctionSpec,
  type SfType,
} from "../registry/index.ts";

/**
 * Field extraction + light type inference for the simulation form (DESIGN §8.1).
 * Walks the AST once, collecting unique field references and the strongest type
 * signal each one is used with (function-argument type, arithmetic → Number,
 * boolean context → Boolean, concat → Text). Ambiguity resolves to a default the
 * user can override in the form — never a hidden guess.
 */
export interface ExtractedField {
  readonly name: string;
  readonly isGlobal: boolean;
  readonly inferredType: SfType;
}

const DEFAULT_TYPE: SfType = "Text";

export function extractFields(ast: Expr): ExtractedField[] {
  const found = new Map<string, { isGlobal: boolean; type: SfType }>();

  function record(name: string, isGlobal: boolean, expected: SfType): void {
    const existing = found.get(name);
    if (!existing) {
      found.set(name, { isGlobal, type: expected });
      return;
    }
    // Prefer a concrete signal over the Unknown/default placeholder.
    if (existing.type === "Unknown" && expected !== "Unknown") {
      found.set(name, { isGlobal, type: expected });
    }
  }

  function walk(node: Expr, expected: SfType): void {
    switch (node.kind) {
      case "FieldRef":
        record(node.path.join("."), node.isGlobal, expected);
        return;
      case "Paren":
        walk(node.expr, expected);
        return;
      case "UnaryOp":
        walk(node.operand, "Number");
        return;
      case "BinaryOp":
        walkBinary(node, walk);
        return;
      case "FunctionCall": {
        const spec = getFunction(node.callee);
        node.args.forEach((arg, i) =>
          walk(arg, spec ? paramType(spec, i) : "Unknown"),
        );
        return;
      }
      default:
        return;
    }
  }

  walk(ast, "Unknown");

  return [...found.entries()].map(([name, info]) => ({
    name,
    isGlobal: info.isGlobal,
    inferredType: info.type === "Unknown" ? DEFAULT_TYPE : info.type,
  }));
}

function walkBinary(
  node: Extract<Expr, { kind: "BinaryOp" }>,
  walk: (n: Expr, t: SfType) => void,
): void {
  switch (node.op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "^":
      walk(node.left, "Number");
      walk(node.right, "Number");
      return;
    case "&":
      walk(node.left, "Text");
      walk(node.right, "Text");
      return;
    case "&&":
    case "||":
      walk(node.left, "Boolean");
      walk(node.right, "Boolean");
      return;
    case "<":
    case "<=":
    case ">":
    case ">=":
      // No single expected type applies to both sides (Name < "M" vs.
      // CloseDate > TODAY() vs. Amount > 100): infer each operand from what
      // its sibling concretely is, rather than assuming Number.
      walk(node.left, orderingHint(node.right));
      walk(node.right, orderingHint(node.left));
      return;
    default:
      // Equality: operands can be anything; no strong signal.
      walk(node.left, "Unknown");
      walk(node.right, "Unknown");
  }
}

/**
 * Type hint an ordering-comparison operand takes from its sibling: a literal
 * pins the type outright, and a call to a function with a fixed (non-dynamic,
 * e.g. not `sameAsArg`) return type pins it too. Anything else carries no
 * signal — "Unknown" defers to the form's default, never a guessed Number.
 */
function orderingHint(sibling: Expr): SfType {
  let node = sibling;
  while (node.kind === "Paren") {
    node = node.expr;
  }
  switch (node.kind) {
    case "StringLit":
      return "Text";
    case "NumberLit":
      return "Number";
    case "FunctionCall": {
      const spec = getFunction(node.callee);
      return spec && spec.returnType.kind === "fixed"
        ? spec.returnType.type
        : "Unknown";
    }
    default:
      return "Unknown";
  }
}

function paramType(spec: FunctionSpec, i: number): SfType {
  const { params } = spec;
  if (i < params.length) {
    return params[i]!.type;
  }
  const last = params[params.length - 1];
  return last?.variadic ? last.type : "Unknown";
}
