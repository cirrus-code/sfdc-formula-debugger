/**
 * A half-open source range `[start, end)` measured in UTF-16 code units (string
 * offsets), matching how editors and CodeMirror address positions. `end` is
 * exclusive, so an empty span has `start === end`.
 *
 * Every token, trivia, and AST node carries a span. It is the anchor for
 * diagnostics, hover, formatting, and highlighting (CLAUDE.md rule 4).
 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export function span(start: number, end: number): Span {
  return { start, end };
}

/** Length of the span in code units. */
export function spanLength(s: Span): number {
  return s.end - s.start;
}

/** Smallest span covering both inputs. */
export function mergeSpans(a: Span, b: Span): Span {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** True if `offset` falls within `[start, end)`. */
export function spanContains(s: Span, offset: number): boolean {
  return offset >= s.start && offset < s.end;
}
