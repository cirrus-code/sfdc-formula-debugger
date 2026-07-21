import type { Span } from "./span.ts";
import type { Trivia } from "./token.ts";

/**
 * Discriminated-union AST for Salesforce formulas. Every node carries a `span`
 * (CLAUDE.md rule 4). One AST feeds every feature (rule 8) — there is no
 * per-feature representation.
 *
 * Numbers are kept as their raw source text; decoding to a value goes through
 * decimal.js in the engine (rule 2 — never introduce an IEEE float here).
 */

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!=";

/** `NOT`/`AND`/`OR` are functions in Salesforce; the only prefix operators are sign. */
export type UnaryOperator = "-" | "+";

/**
 * Comments attached to a node for the formatter (rule 5). Populated by the
 * formatter phase; the parser leaves it undefined. The shape is fixed now so
 * the AST type is stable for downstream layers.
 */
export interface NodeComments {
  readonly leading: readonly Trivia[];
  readonly trailing: readonly Trivia[];
}

interface NodeBase {
  readonly span: Span;
  readonly comments?: NodeComments;
}

export interface NumberLit extends NodeBase {
  readonly kind: "NumberLit";
  /** Exact source text (e.g. "1.50"); parsed via decimal.js downstream. */
  readonly raw: string;
}

export interface StringLit extends NodeBase {
  readonly kind: "StringLit";
  /** Decoded value with quotes stripped and escapes resolved. */
  readonly value: string;
  /** Exact source text including quotes, for lossless formatting. */
  readonly raw: string;
}

export interface BooleanLit extends NodeBase {
  readonly kind: "BooleanLit";
  readonly value: boolean;
}

export interface NullLit extends NodeBase {
  readonly kind: "NullLit";
}

/**
 * A field reference. Dotted cross-object paths are a single flat reference
 * (`Account.Owner.Name` → `path: ["Account", "Owner", "Name"]`). Globals keep
 * their `$` on the first segment and set `isGlobal`.
 */
export interface FieldRef extends NodeBase {
  readonly kind: "FieldRef";
  readonly path: readonly string[];
  readonly isGlobal: boolean;
}

export interface FunctionCall extends NodeBase {
  readonly kind: "FunctionCall";
  /** Callee as written; registry lookup normalizes case. */
  readonly callee: string;
  readonly calleeSpan: Span;
  readonly args: readonly Expr[];
}

export interface BinaryOp extends NodeBase {
  readonly kind: "BinaryOp";
  readonly op: BinaryOperator;
  readonly opSpan: Span;
  readonly left: Expr;
  readonly right: Expr;
}

export interface UnaryOp extends NodeBase {
  readonly kind: "UnaryOp";
  readonly op: UnaryOperator;
  readonly opSpan: Span;
  readonly operand: Expr;
}

/** Explicit parentheses, preserved so formatting is faithful (DESIGN §3.3). */
export interface Paren extends NodeBase {
  readonly kind: "Paren";
  readonly expr: Expr;
}

/** An unparseable region. Downstream passes treat it as opaque/Unknown-typed. */
export interface ErrorNode extends NodeBase {
  readonly kind: "ErrorNode";
}

export type Expr =
  | NumberLit
  | StringLit
  | BooleanLit
  | NullLit
  | FieldRef
  | FunctionCall
  | BinaryOp
  | UnaryOp
  | Paren
  | ErrorNode;

export type NodeKind = Expr["kind"];

/**
 * Compile-time exhaustiveness guard for `switch` over `NodeKind`. Adding a node
 * kind makes every unhandled switch fail to compile (CLAUDE.md conventions).
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled AST node: ${JSON.stringify(x)}`);
}
