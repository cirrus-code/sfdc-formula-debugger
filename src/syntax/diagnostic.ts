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
  | "invisible-character"
  | "nonstandard-whitespace"
  | "confusable-character"
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
  | "argument-type-rejected"
  | "operator-type-mismatch"
  | "function-not-available"
  | "return-type-mismatch"
  | "nonstandard-operator"
  // Linter (features/linter.ts)
  | "hardcoded-id"
  | "deep-if-nesting"
  | "prefer-ispickval"
  | "discouraged-function"
  | "char-limit"
  | "invisible-in-string";

/** A single replacement of a source range; `newText: ""` deletes it. */
export interface TextEdit {
  readonly span: Span;
  readonly newText: string;
}

/**
 * Machine-applicable remedy attached to a diagnostic, surfaced by the editor
 * as a quick-fix action. Edits address original-source offsets; the edits of
 * one fix never overlap, and fixes of distinct diagnostics never overlap
 * either, so any subset can be applied in one batch.
 */
export interface DiagnosticFix {
  /** Short imperative label (localized), e.g. "Remove invisible character". */
  readonly title: string;
  readonly edits: readonly TextEdit[];
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly span: Span;
  readonly message: string;
  /** Optional "learn more" link, rendered by the Problems panel. */
  readonly docsUrl?: string | undefined;
  /** Optional quick-fix, rendered by the editor as a clickable action. */
  readonly fix?: DiagnosticFix | undefined;
}
