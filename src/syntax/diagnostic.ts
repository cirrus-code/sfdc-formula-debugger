import type { Span } from "./span.ts";

export type Severity = "error" | "warning" | "info";

/**
 * Stable, machine-readable identifiers for every diagnostic the pipeline can
 * emit. Tests assert on these codes (not on message wording), so messages can
 * be reworded freely without breaking the error-recovery suite. Add a new code
 * here rather than emitting an ad-hoc string.
 */
export type DiagnosticCode =
  // Lexer
  | "unterminated-string"
  | "unterminated-comment"
  | "unexpected-character"
  | "nested-comment"
  | "invalid-escape"
  // Parser
  | "expected-expression"
  | "expected-closing-paren"
  | "expected-field-name"
  | "unexpected-token"
  | "nesting-too-deep"
  // Analysis
  | "unknown-function"
  | "wrong-arity"
  | "argument-type-mismatch"
  | "operator-type-mismatch"
  | "function-not-available"
  | "return-type-mismatch"
  | "nonstandard-operator"
  // Linter (features/linter.ts)
  | "hardcoded-id"
  | "deep-if-nesting"
  | "prefer-ispickval"
  | "discouraged-function"
  | "char-limit";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly span: Span;
  readonly message: string;
  /** Optional "learn more" link, rendered by the Problems panel. */
  readonly docsUrl?: string | undefined;
}
