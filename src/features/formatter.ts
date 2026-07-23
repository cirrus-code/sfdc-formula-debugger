import {
  assertNever,
  BINARY_PRECEDENCE,
  parse,
  spanLength,
  type Expr,
  type Token,
  type Trivia,
} from "../syntax/index.ts";

/**
 * Formatter (DESIGN §8.3): a pretty-printer over the AST. Canonical operator
 * spacing, precedence-driven parentheses, explicit `Paren` nodes preserved,
 * function calls broken one-argument-per-line past the width, and comments
 * (rule 5) reattached in position.
 *
 * Because `format = parse + print` and printing only ever changes trivia
 * (whitespace/line breaks), never node structure, the two rule-6 guarantees hold
 * by construction:
 *   - reparse-equality: `parse(format(x))` is structurally equal to `parse(x)`;
 *   - idempotence: `format(format(x)) === format(x)`, which follows from
 *     reparse-equality plus a deterministic printer.
 *
 * Comment placement is a fixed point too: the lexer anchors each comment to the
 * following token, so emitting it just before that token's position re-anchors
 * it identically on reparse (see `attachComments`).
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
  const comments = attachComments(ast, tokens);
  return render(ast, { ...DEFAULTS, ...options }, comments);
}

/**
 * Format an AST node directly (used by the simplifier to render rewrites).
 * Synthetic ASTs carry no comments, so none are emitted.
 */
export function formatExpr(node: Expr, options: FormatOptions = {}): string {
  return render(node, { ...DEFAULTS, ...options }, EMPTY_COMMENTS);
}

interface Opts {
  readonly indentWidth: number;
  readonly maxWidth: number;
}

interface CommentSlots {
  readonly leading: Trivia[];
  readonly trailing: Trivia[];
}
type CommentMap = ReadonlyMap<Expr, CommentSlots>;
const EMPTY_COMMENTS: CommentMap = new Map();

function render(node: Expr, opts: Opts, comments: CommentMap): string {
  return pretty(node, 0, opts, comments);
}

// --- comment attachment --------------------------------------------------

/**
 * Assign each block comment to an AST node. A comment whose anchor token
 * (the token it is leading trivia of) *starts* a node becomes that node's
 * leading comment; otherwise it becomes a trailing comment of the node that ends
 * immediately before it. Both re-anchor to the same token on reparse, so the
 * placement is stable under repeated formatting.
 */
function attachComments(root: Expr, tokens: readonly Token[]): CommentMap {
  const nodes: Expr[] = [];
  collect(root, nodes);

  // Deepest node beginning at each source offset (smaller span == deeper).
  const byStart = new Map<number, Expr>();
  for (const n of nodes) {
    const existing = byStart.get(n.span.start);
    if (!existing || spanLength(n.span) <= spanLength(existing.span)) {
      byStart.set(n.span.start, n);
    }
  }

  const map = new Map<Expr, CommentSlots>();
  const slotsFor = (n: Expr): CommentSlots => {
    let s = map.get(n);
    if (!s) {
      s = { leading: [], trailing: [] };
      map.set(n, s);
    }
    return s;
  };

  for (const token of tokens) {
    for (const tr of token.leadingTrivia) {
      if (tr.kind !== "comment") {
        continue;
      }
      const starts = byStart.get(token.span.start);
      if (starts) {
        slotsFor(starts).leading.push(tr);
        continue;
      }
      const preceding = precedingNode(nodes, tr.span.start);
      if (preceding) {
        slotsFor(preceding).trailing.push(tr);
        continue;
      }
      // A comment sitting inside a node but before its first child token (e.g.
      // between a function name and its `(`): keep it as a leading comment of the
      // enclosing node rather than lose it.
      slotsFor(innermostContaining(nodes, tr.span.start) ?? root).leading.push(
        tr,
      );
    }
  }
  return map;
}

function collect(node: Expr, out: Expr[]): void {
  out.push(node);
  switch (node.kind) {
    case "FunctionCall":
      node.args.forEach((a) => collect(a, out));
      return;
    case "BinaryOp":
      collect(node.left, out);
      collect(node.right, out);
      return;
    case "UnaryOp":
      collect(node.operand, out);
      return;
    case "Paren":
      collect(node.expr, out);
      return;
    default:
      return;
  }
}

/** Node ending closest before `offset` (deepest on ties) — the comment's left neighbour. */
function precedingNode(nodes: readonly Expr[], offset: number): Expr | null {
  let best: Expr | null = null;
  for (const n of nodes) {
    if (n.span.end > offset) {
      continue;
    }
    if (
      !best ||
      n.span.end > best.span.end ||
      (n.span.end === best.span.end && n.span.start > best.span.start)
    ) {
      best = n;
    }
  }
  return best;
}

/** Smallest node whose span contains `offset`. */
function innermostContaining(
  nodes: readonly Expr[],
  offset: number,
): Expr | null {
  let best: Expr | null = null;
  for (const n of nodes) {
    if (n.span.start <= offset && offset < n.span.end) {
      if (!best || spanLength(n.span) < spanLength(best.span)) {
        best = n;
      }
    }
  }
  return best;
}

// --- printing ------------------------------------------------------------

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

function leadingStr(node: Expr, comments: CommentMap): string {
  const s = comments.get(node);
  return s ? s.leading.map((c) => `${c.text} `).join("") : "";
}

function trailingStr(node: Expr, comments: CommentMap): string {
  const s = comments.get(node);
  return s ? s.trailing.map((c) => ` ${c.text}`).join("") : "";
}

/** Single-line rendering with comments — the measurement used for break decisions. */
function flat(node: Expr, comments: CommentMap): string {
  return (
    leadingStr(node, comments) +
    flatCore(node, comments) +
    trailingStr(node, comments)
  );
}

function flatCore(node: Expr, comments: CommentMap): string {
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
      return `${node.callee}(${node.args.map((a) => flat(a, comments)).join(", ")})`;
    case "BinaryOp":
      return `${flatOperand(node.left, node, "left", comments)} ${node.op} ${flatOperand(node.right, node, "right", comments)}`;
    case "UnaryOp":
      return `${node.op}${flatOperand(node.operand, node, "left", comments)}`;
    case "Paren":
      return `(${flat(node.expr, comments)})`;
    case "ErrorNode":
      return "";
    default:
      return assertNever(node);
  }
}

function flatOperand(
  child: Expr,
  parent: Expr,
  side: "left" | "right",
  comments: CommentMap,
): string {
  const inner = flat(child, comments);
  return needsParens(child, parent, side) ? `(${inner})` : inner;
}

/**
 * A child needs parentheses when its precedence is lower than the parent's, or
 * equal but on the associativity-losing side. All operators are left-associative,
 * so an equal-precedence right operand must be wrapped. Fires for synthetic ASTs
 * (a parsed tree carries explicit `Paren` nodes); the simplifier also consults it
 * to decide which explicit parens are redundant.
 */
export function needsParens(
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
  return (
    childPrec === parentPrec && side === "right" && parent.kind === "BinaryOp"
  );
}

function pretty(
  node: Expr,
  level: number,
  opts: Opts,
  comments: CommentMap,
): string {
  return (
    leadingStr(node, comments) +
    prettyCore(node, level, opts, comments) +
    trailingStr(node, comments)
  );
}

function prettyCore(
  node: Expr,
  level: number,
  opts: Opts,
  comments: CommentMap,
): string {
  switch (node.kind) {
    case "FunctionCall": {
      const oneLine = flatCore(node, comments);
      if (
        node.args.length === 0 ||
        level * opts.indentWidth + oneLine.length <= opts.maxWidth
      ) {
        return oneLine;
      }
      const inner = indent(level + 1, opts);
      const body = node.args
        .map((arg) => inner + pretty(arg, level + 1, opts, comments))
        .join(",\n");
      return `${node.callee}(\n${body}\n${indent(level, opts)})`;
    }
    case "BinaryOp":
      return `${prettyOperand(node.left, node, "left", level, opts, comments)} ${node.op} ${prettyOperand(node.right, node, "right", level, opts, comments)}`;
    case "UnaryOp":
      return `${node.op}${prettyOperand(node.operand, node, "left", level, opts, comments)}`;
    case "Paren":
      return `(${pretty(node.expr, level, opts, comments)})`;
    default:
      return flatCore(node, comments);
  }
}

function prettyOperand(
  child: Expr,
  parent: Expr,
  side: "left" | "right",
  level: number,
  opts: Opts,
  comments: CommentMap,
): string {
  const inner = pretty(child, level, opts, comments);
  return needsParens(child, parent, side) ? `(${inner})` : inner;
}
