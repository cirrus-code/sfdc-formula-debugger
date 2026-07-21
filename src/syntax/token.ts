import type { Span } from "./span.ts";
import type { Diagnostic } from "./diagnostic.ts";

/**
 * Token kinds. Operators collapse into a single `"operator"` kind whose lexeme
 * lives in `Token.text` (the Pratt parser keys its precedence table on that
 * lexeme); structural punctuation gets distinct kinds because the parser
 * branches on them directly. Keyword literals (`TRUE`/`FALSE`/`NULL`) get their
 * own kinds because they map to distinct AST literal nodes.
 *
 * `"error"` is emitted for characters the lexer cannot classify — lexing never
 * throws (CLAUDE.md rule 3 / DESIGN §3.1), so unknown input becomes a token.
 * `"eof"` is a zero-width sentinel that always terminates the stream and holds
 * any trailing trivia.
 */
export type TokenKind =
  | "number"
  | "string"
  | "true"
  | "false"
  | "null"
  | "identifier"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "dot"
  | "error"
  | "eof";

export type TriviaKind = "whitespace" | "comment";

/**
 * Non-semantic source text (whitespace, `/* *​/` comments) preserved so the
 * lexer is lossless and the formatter can reattach comments. Trivia is never
 * discarded — it is attached as leading trivia to the following token (trailing
 * trivia on the final `eof` token).
 */
export interface Trivia {
  readonly kind: TriviaKind;
  readonly text: string;
  readonly span: Span;
}

export interface Token {
  readonly kind: TokenKind;
  /** Exact source lexeme; empty string for `eof`. */
  readonly text: string;
  readonly span: Span;
  /** All trivia between the previous token's end and this token's start. */
  readonly leadingTrivia: readonly Trivia[];
}

export interface LexResult {
  /** Always non-empty and always terminated by exactly one `eof` token. */
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reconstruct the original source from a token stream. Because every source
 * byte is either a token lexeme or trivia, this is an exact inverse of lexing —
 * the property the lexer round-trip test enforces.
 */
export function tokensToSource(tokens: readonly Token[]): string {
  let out = "";
  for (const t of tokens) {
    for (const tr of t.leadingTrivia) out += tr.text;
    out += t.text;
  }
  return out;
}
