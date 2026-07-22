import {
  assertNever,
  BINARY_PRECEDENCE,
  parse,
  type Expr,
  type Token,
} from "../syntax/index.ts";

/**
 * Formatter (DESIGN §8.3): a pretty-printer over the AST. Canonical operator
 * spacing, precedence-driven parentheses, explicit `Paren` nodes preserved, and
 * function calls that don't fit the width broken one-argument-per-line.
 *
 * Because `format = parse + print` and printing only ever changes trivia
 * (whitespace/line breaks) — never node structure — the two guarantees in
 * CLAUDE.md rule 6 hold by construction:
 *   - reparse-equality: `parse(format(x))` is structurally equal to `parse(x)`;
 *   - idempotence: `format(format(x)) === format(x)`, which follows from
 *     reparse-equality plus a deterministic printer.
 *
 * Comment preservation (rule 5) is layered on in a later pass; the printer here
 * is the structural core.
 */
export interface FormatOptions {
  /** Spaces per indent level. */
  readonly indentWidth?: number;
  /** Column past which a function call breaks across lines. */
  readonly maxWidth?: number;
}

const DEFAULTS = { indentWidth: 2, maxWidth: 80 } as const;

/**
 * Format a formula's source. Invalid input (a syntax error, so the AST is only
 * partially recovered) is returned unchanged rather than risking a destructive
 * reformat — formatting is a user action on text they may still be editing.
 */
export function format(source: string, options: FormatOptions = {}): string {
  const { ast, diagnostics, tokens } = parse(source);
  if (
    ast.kind === "ErrorNode" ||
    diagnostics.some((d) => d.severity === "error")
  ) {
    return source;
  }
  // Comment preservation (rule 5) lands in a dedicated pass; until then a
  // comment-bearing formula is returned untouched rather than have its comments
  // dropped — the structural printer here does not yet re-emit them.
  if (hasComment(tokens)) {
    return source;
  }
  return formatExpr(ast, options);
}

function hasComment(tokens: readonly Token[]): boolean {
  return tokens.some((t) =>
    t.leadingTrivia.some((tr) => tr.kind === "comment"),
  );
}

/** Format an AST node directly (used by the simplifier to render rewrites). */
export function formatExpr(node: Expr, options: FormatOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  return pretty(node, 0, opts);
}

interface Opts {
  readonly indentWidth: number;
  readonly maxWidth: number;
}

// Unary operators bind tighter than every binary operator (Formula.g4); leaves,
// calls, and parenthesized groups are atomic and never need wrapping.
const UNARY_PRECEDENCE = 100;
const ATOM_PRECEDENCE = Infinity;

function precedence(node: Expr): number {
  switch (node.kind) {
    case "BinaryOp":
      return BINARY_PRECEDENCE[node.op];
    case "UnaryOp":
      return UNARY_PRECEDENCE;
    default:
      return ATOM_PRECEDENCE;
  }
}

function indent(level: number, opts: Opts): string {
  return " ".repeat(level * opts.indentWidth);
}

/** Single-line canonical rendering — the measurement used for break decisions. */
function flat(node: Expr): string {
  switch (node.kind) {
    case "NumberLit":
      return node.raw;
    case "StringLit":
      return node.raw;
    case "BooleanLit":
      return node.value ? "TRUE" : "FALSE";
    case "NullLit":
      return "NULL";
    case "FieldRef":
      return node.path.join(".");
    case "FunctionCall":
      return `${node.callee}(${node.args.map(flat).join(", ")})`;
    case "BinaryOp":
      return `${flatOperand(node.left, node, "left")} ${node.op} ${flatOperand(node.right, node, "right")}`;
    case "UnaryOp":
      return `${node.op}${flatOperand(node.operand, node, "left")}`;
    case "Paren":
      return `(${flat(node.expr)})`;
    case "ErrorNode":
      return "";
    default:
      return assertNever(node);
  }
}

function flatOperand(child: Expr, parent: Expr, side: "left" | "right"): string {
  const inner = flat(child);
  return needsParens(child, parent, side) ? `(${inner})` : inner;
}

/**
 * A child needs parentheses when its precedence is lower than the parent's, or
 * equal but on the associativity-losing side (all operators are left-associative,
 * so an equal-precedence right operand must be wrapped). This only ever fires for
 * synthetic ASTs — a parsed tree already carries explicit `Paren` nodes — so it
 * never adds parens the source didn't have.
 */
function needsParens(
  child: Expr,
  parent: Expr,
  side: "left" | "right",
): boolean {
  const childPrec = precedence(child);
  const parentPrec =
    parent.kind === "UnaryOp" ? UNARY_PRECEDENCE : precedence(parent);
  if (childPrec < parentPrec) {
    return true;
  }
  // Every Salesforce binary operator is left-associative (Formula.g4), so an
  // equal-precedence right operand loses to the parent and must be wrapped.
  return (
    childPrec === parentPrec && side === "right" && parent.kind === "BinaryOp"
  );
}

function pretty(node: Expr, level: number, opts: Opts): string {
  switch (node.kind) {
    case "FunctionCall": {
      const oneLine = flat(node);
      if (
        node.args.length === 0 ||
        level * opts.indentWidth + oneLine.length <= opts.maxWidth
      ) {
        return oneLine;
      }
      const inner = indent(level + 1, opts);
      const body = node.args
        .map((arg) => inner + pretty(arg, level + 1, opts))
        .join(",\n");
      return `${node.callee}(\n${body}\n${indent(level, opts)})`;
    }
    case "BinaryOp":
      return `${prettyOperand(node.left, node, "left", level, opts)} ${node.op} ${prettyOperand(node.right, node, "right", level, opts)}`;
    case "UnaryOp":
      return `${node.op}${prettyOperand(node.operand, node, "left", level, opts)}`;
    case "Paren":
      return `(${pretty(node.expr, level, opts)})`;
    default:
      return flat(node);
  }
}

function prettyOperand(
  child: Expr,
  parent: Expr,
  side: "left" | "right",
  level: number,
  opts: Opts,
): string {
  const inner = pretty(child, level, opts);
  return needsParens(child, parent, side) ? `(${inner})` : inner;
}
