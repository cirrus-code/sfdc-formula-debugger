import { span, type Span } from "./span.ts";

/**
 * Characters that arrive via copy-paste from web pages and word processors
 * but are not valid formula syntax. Two disjoint groups:
 *
 *  - Paste artifacts: invisible format/control characters (zero-width spaces,
 *    BOM, bidi controls) and non-ASCII whitespace (no-break space, ideographic
 *    space). The lexer recovers these as `"invisible"` trivia so the rest of
 *    the formula still parses, and diagnoses each run with a removal or
 *    replace-with-space fix.
 *  - Confusables: visible typographic characters with an obvious ASCII intent
 *    (curly quotes, en/em dashes, fullwidth punctuation). These stay error
 *    tokens; their diagnostics carry the intended replacement.
 *
 * Salesforce's own help pages embed zero-width spaces inside sample formulas,
 * so pasted-from-docs input is a primary path into the editor, not an edge
 * case.
 */

export type PasteCharKind = "format" | "space";

// The lexer's ordinary whitespace; never classified as a paste artifact.
const ASCII_WHITESPACE = /^[ \t\n\r\f\v]$/;

// With the `u` flag a character class matches whole code points, so these
// classify astral characters correctly when handed a full code point.
const FORMAT_OR_CONTROL = /^[\p{Cf}\p{Cc}]$/u;
const UNICODE_SPACE = /^[\p{Zs}\p{Zl}\p{Zp}]$/u;

/**
 * Classify one full code point as a paste artifact: `"space"` for non-ASCII
 * whitespace (fix: replace with a regular space, preserving token separation),
 * `"format"` for invisible format/control characters (fix: delete — the user
 * never saw them). `null` for ordinary formula text.
 */
export function classifyPasteChar(ch: string): PasteCharKind | null {
  if (ch === "" || ASCII_WHITESPACE.test(ch)) {
    return null;
  }
  if (UNICODE_SPACE.test(ch)) {
    return "space";
  }
  if (FORMAT_OR_CONTROL.test(ch)) {
    return "format";
  }
  return null;
}

/**
 * One-character pattern matching exactly what `classifyPasteChar` flags. The
 * editor derives its special-character rendering from this, so what gets a
 * visible placeholder can never drift from what gets diagnosed. Kept
 * `u`-flag-compatible (no `v`-only class subtraction): CodeMirror recompiles
 * the pattern source under its own flags.
 */
export const PASTE_CHAR_PATTERN =
  /(?![\t\n\v\f\r ])[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}]/u;

/**
 * True when the source contains at most the lexer's ordinary ASCII
 * whitespace — the UI's "nothing typed yet" predicate. Not
 * `String.prototype.trim()`: trim() also strips NBSP, BOM, and other paste
 * artifacts, which would silently hide their diagnostics for a document
 * consisting only of pasted invisible characters.
 */
export function isBlankSource(source: string): boolean {
  return /^[ \t\n\r\f\v]*$/.test(source);
}

/** Uppercase hex of the first code point, zero-padded to the conventional
 * four digits (`200B`, `1F389`) — displayed as `U+XXXX` in messages. */
export function codePointHex(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Visible typographic characters mapped to the ASCII character the author
 * almost certainly meant. Word processors auto-substitute the first three
 * groups; the fullwidth block arrives from CJK input methods.
 */
export const CONFUSABLE_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  // Quotes and apostrophes.
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["‛", "'"],
  ["ʼ", "'"],
  ["“", '"'],
  ["”", '"'],
  ["„", '"'],
  ["‟", '"'],
  ["«", '"'],
  ["»", '"'],
  // Dashes and minus signs.
  ["‐", "-"],
  ["‑", "-"],
  ["‒", "-"],
  ["–", "-"],
  ["—", "-"],
  ["―", "-"],
  ["−", "-"],
  // Arithmetic look-alikes.
  ["×", "*"],
  ["÷", "/"],
  ["⁄", "/"],
  // Fullwidth punctuation.
  ["！", "!"],
  ["＂", '"'],
  ["＆", "&"],
  ["＇", "'"],
  ["（", "("],
  ["）", ")"],
  ["＊", "*"],
  ["＋", "+"],
  ["，", ","],
  ["－", "-"],
  ["．", "."],
  ["／", "/"],
  ["＜", "<"],
  ["＝", "="],
  ["＞", ">"],
]);

/**
 * For each accepted opening quote, the characters that terminate the literal.
 * Typographic openers also close at the straight form so a half-fixed string
 * still lexes as one token. Straight openers close only at themselves — a
 * typographic quote *inside* a valid straight-quoted string is legal content
 * and must not end it.
 */
const QUOTE_CLOSERS: ReadonlyMap<string, readonly string[]> = new Map([
  ['"', ['"']],
  ["'", ["'"]],
  ["“", ["”", '"']],
  ["‘", ["’", "'"]],
]);

export function isQuoteOpener(ch: string): boolean {
  return QUOTE_CLOSERS.has(ch);
}

export function stringClosers(opener: string): readonly string[] {
  return QUOTE_CLOSERS.get(opener) ?? [opener];
}

export interface PasteCharRun {
  /** The repeated code point. */
  readonly char: string;
  readonly kind: PasteCharKind;
  readonly count: number;
  readonly span: Span;
}

/**
 * Group consecutive identical paste-artifact code points in `text` into runs;
 * spans are offset by `base` (the text's position in the source). Used by the
 * linter to flag invisible characters inside string literals, where they are
 * legal content but almost certainly unintended.
 */
export function findPasteCharRuns(text: string, base: number): PasteCharRun[] {
  const runs: PasteCharRun[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const kind = classifyPasteChar(ch);
    if (kind === null) {
      i += ch.length;
      continue;
    }
    const start = i;
    let count = 0;
    while (text.startsWith(ch, i)) {
      i += ch.length;
      count++;
    }
    runs.push({ char: ch, kind, count, span: span(base + start, base + i) });
  }
  return runs;
}
