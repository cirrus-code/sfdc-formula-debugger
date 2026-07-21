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
  | "unexpected-character";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly span: Span;
  readonly message: string;
}
