import { t } from "../i18n/index.ts";
import { span, type Span } from "./span.ts";
import type { Diagnostic, DiagnosticFix, TextEdit } from "./diagnostic.ts";
import type { LexResult, Token, TokenKind, Trivia } from "./token.ts";
import {
  classifyPasteChar,
  codePointHex,
  CONFUSABLE_REPLACEMENTS,
  isQuoteOpener,
  stringClosers,
  type PasteCharKind,
} from "./chars.ts";

/**
 * Hand-written scanner producing a flat, lossless token stream with spans.
 *
 * Invariants (DESIGN §3.1):
 *  - Never throws. Unknown characters become `"error"` tokens with diagnostics.
 *  - Lossless: every source code unit lands in exactly one token lexeme or one
 *    piece of trivia, so `tokensToSource(tokens) === source`.
 *  - No reserved identifier prefixes: `Null_Check__c`, `TRUEFIELD__c` lex as
 *    identifiers. `TRUE`/`FALSE`/`NULL` are recognized only as complete,
 *    case-insensitive tokens.
 *
 * Pasted invisible characters (zero-width spaces from Salesforce's own help
 * pages, no-break spaces from HTML) become `"invisible"` trivia — not error
 * tokens — each run diagnosed once with a removal/replacement fix, so a paste
 * yields a handful of precise, fixable diagnostics instead of a parse-error
 * cascade. Visible typographic characters (curly quotes, en dashes) stay
 * error tokens but carry the intended ASCII replacement as a fix.
 */
export function lex(source: string): LexResult {
  return new Lexer(source).run();
}

const KEYWORD_KINDS: Record<string, TokenKind> = {
  TRUE: "true",
  FALSE: "false",
  NULL: "null",
};

/** The nine escapes formula-engine's STRING_LITERAL grammar rule accepts. */
const VALID_STRING_ESCAPES = new Set([
  "n",
  "r",
  "t",
  "N",
  "R",
  "T",
  '"',
  "'",
  "\\",
]);

class Lexer {
  private pos = 0;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly src: string) {}

  run(): LexResult {
    for (;;) {
      const leading = this.scanTrivia();
      if (this.pos >= this.src.length) {
        this.tokens.push({
          kind: "eof",
          text: "",
          span: span(this.pos, this.pos),
          leadingTrivia: leading,
        });
        break;
      }
      this.tokens.push(this.scanToken(leading));
    }
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  /** The full code point at the cursor (1 or 2 UTF-16 units); "" at EOF. */
  private peekChar(): string {
    const cp = this.src.codePointAt(this.pos);
    return cp === undefined ? "" : String.fromCodePoint(cp);
  }

  private token(
    kind: TokenKind,
    start: number,
    leading: readonly Trivia[],
  ): Token {
    return {
      kind,
      text: this.src.slice(start, this.pos),
      span: span(start, this.pos),
      leadingTrivia: leading,
    };
  }

  private error(
    code: Diagnostic["code"],
    s: Span,
    message: string,
    fix?: DiagnosticFix,
  ): void {
    this.diagnostics.push({ code, severity: "error", span: s, message, fix });
  }

  // --- Trivia -------------------------------------------------------------

  private scanTrivia(): Trivia[] {
    const trivia: Trivia[] = [];
    for (;;) {
      const c = this.peek();
      if (c === "") {
        break;
      }
      if (isWhitespace(c)) {
        const start = this.pos;
        while (isWhitespace(this.peek())) {
          this.pos++;
        }
        trivia.push({
          kind: "whitespace",
          text: this.src.slice(start, this.pos),
          span: span(start, this.pos),
        });
      } else if (c === "/" && this.peek(1) === "*") {
        trivia.push(this.scanBlockComment());
      } else {
        const ch = this.peekChar();
        const pasteKind = classifyPasteChar(ch);
        if (pasteKind === null) {
          break;
        }
        trivia.push(this.scanPasteArtifact(ch, pasteKind));
      }
    }
    return trivia;
  }

  /**
   * A run of one repeated invisible/non-standard character becomes a single
   * piece of `"invisible"` trivia plus one error diagnostic carrying a
   * removal fix (format/control characters — the user never saw them) or a
   * replace-with-space fix (Unicode spaces — they visually separate tokens).
   */
  private scanPasteArtifact(ch: string, kind: PasteCharKind): Trivia {
    const start = this.pos;
    while (this.src.startsWith(ch, this.pos)) {
      this.pos += ch.length;
    }
    const count = (this.pos - start) / ch.length;
    const s = span(start, this.pos);
    const hex = codePointHex(ch);
    const name = t().syntax.lexer.characterNames[hex] ?? null;
    if (kind === "space") {
      this.error(
        "nonstandard-whitespace",
        s,
        t().syntax.lexer.nonstandardSpace(hex, name, count),
        {
          title: t().syntax.lexer.fixes.replaceWithSpace(count),
          edits: [{ span: s, newText: " ".repeat(count) }],
        },
      );
    } else {
      this.error(
        "invisible-character",
        s,
        t().syntax.lexer.invisibleCharacter(hex, name, count),
        {
          title: t().syntax.lexer.fixes.removeInvisible(count),
          edits: [{ span: s, newText: "" }],
        },
      );
    }
    return {
      kind: "invisible",
      text: this.src.slice(start, this.pos),
      span: s,
    };
  }

  private scanBlockComment(): Trivia {
    const start = this.pos;
    this.pos += 2; // consume "/*"
    while (
      this.pos < this.src.length &&
      !(this.peek() === "*" && this.peek(1) === "/")
    ) {
      // Comments do not nest (org-verified: the first `*/` closes), so an
      // inner `/*` is legal but almost certainly not what the author meant —
      // everything after the first `*/` is live formula text.
      if (this.peek() === "/" && this.peek(1) === "*") {
        this.diagnostics.push({
          code: "nested-comment",
          severity: "warning",
          span: span(this.pos, this.pos + 2),
          message: t().syntax.lexer.nestedComment,
        });
      }
      this.pos++;
    }
    if (this.pos >= this.src.length) {
      this.error(
        "unterminated-comment",
        span(start, this.pos),
        t().syntax.lexer.unterminatedComment,
      );
    } else {
      this.pos += 2; // consume "*/"
    }
    return {
      kind: "comment",
      text: this.src.slice(start, this.pos),
      span: span(start, this.pos),
    };
  }

  // --- Tokens -------------------------------------------------------------

  private scanToken(leading: readonly Trivia[]): Token {
    const start = this.pos;
    const c = this.peek();

    if (isQuoteOpener(c)) {
      return this.scanString(start, leading);
    }
    if (isDigit(c)) {
      return this.scanNumber(start, leading);
    }
    if (c === "." && isDigit(this.peek(1))) {
      return this.scanNumber(start, leading);
    }
    if (isIdentStart(c)) {
      return this.scanIdentifier(start, leading);
    }
    if (c === "$") {
      return this.scanGlobalIdentifier(start, leading);
    }

    return this.scanPunctuationOrOperator(start, leading, c);
  }

  /**
   * Strings open with straight or typographic quotes (see chars.ts for the
   * accepted opener→closer pairs). A typographically-quoted string still lexes
   * as one string token — recovery that keeps the AST intact — but is
   * diagnosed as an error with a straighten-the-quotes fix.
   */
  private scanString(start: number, leading: readonly Trivia[]): Token {
    const quote = this.peek();
    const closers = stringClosers(quote);
    this.pos++; // opening quote
    let closer: string | null = null;
    for (;;) {
      const c = this.peek();
      if (c === "") {
        this.error(
          "unterminated-string",
          span(start, this.pos),
          t().syntax.lexer.unterminatedString,
        );
        break;
      }
      if (c === "\\" && this.peek(1) !== "") {
        // The product grammar (formula-engine LexerRules.g4, STRING_LITERAL)
        // rejects any backslash not starting one of the nine listed escapes.
        // We diagnose instead and keep lexing for recovery.
        if (!VALID_STRING_ESCAPES.has(this.peek(1))) {
          this.error(
            "invalid-escape",
            span(this.pos, this.pos + 2),
            t().syntax.lexer.invalidEscape(this.peek(1)),
          );
        }
        this.pos += 2;
        continue;
      }
      this.pos++;
      if (closers.includes(c)) {
        closer = c;
        break;
      }
    }
    const edits: TextEdit[] = [];
    const straightOpen = CONFUSABLE_REPLACEMENTS.get(quote);
    if (straightOpen !== undefined) {
      edits.push({ span: span(start, start + 1), newText: straightOpen });
    }
    if (closer !== null) {
      const straightClose = CONFUSABLE_REPLACEMENTS.get(closer);
      if (straightClose !== undefined) {
        edits.push({
          span: span(this.pos - 1, this.pos),
          newText: straightClose,
        });
      }
    }
    if (edits.length > 0) {
      this.error(
        "confusable-character",
        span(start, this.pos),
        t().syntax.lexer.typographicQuotes,
        { title: t().syntax.lexer.fixes.straightenQuotes, edits },
      );
    }
    return this.token("string", start, leading);
  }

  private scanNumber(start: number, leading: readonly Trivia[]): Token {
    while (isDigit(this.peek())) {
      this.pos++;
    }
    // Fractional part only when a digit follows the dot, so `1.` lexes as
    // number `1` + `.` and `ADDMONTHS(x,1).Field` splits cleanly.
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.pos++; // consume "."
      while (isDigit(this.peek())) {
        this.pos++;
      }
    }
    return this.token("number", start, leading);
  }

  private scanIdentifier(start: number, leading: readonly Trivia[]): Token {
    while (isIdentContinue(this.peek())) {
      this.pos++;
    }
    const text = this.src.slice(start, this.pos);
    const keyword = KEYWORD_KINDS[text.toUpperCase()];
    return this.token(keyword ?? "identifier", start, leading);
  }

  private scanGlobalIdentifier(
    start: number,
    leading: readonly Trivia[],
  ): Token {
    this.pos++; // consume "$"
    if (!isIdentStart(this.peek())) {
      // A lone `$` is not a valid identifier; emit an error token so the rest
      // of the formula still lexes.
      this.error(
        "unexpected-character",
        span(start, this.pos),
        t().syntax.lexer.unexpectedDollar,
      );
      return this.token("error", start, leading);
    }
    while (isIdentContinue(this.peek())) {
      this.pos++;
    }
    // Globals are never keywords ($TRUE is a field reference, not a boolean).
    return this.token("identifier", start, leading);
  }

  private scanPunctuationOrOperator(
    start: number,
    leading: readonly Trivia[],
    c: string,
  ): Token {
    switch (c) {
      case "(":
        this.pos++;
        return this.token("lparen", start, leading);
      case ")":
        this.pos++;
        return this.token("rparen", start, leading);
      case ",":
        this.pos++;
        return this.token("comma", start, leading);
      case ".":
        this.pos++;
        return this.token("dot", start, leading);
      case "+":
      case "-":
      case "*":
      case "/":
      case "^":
        this.pos++;
        return this.token("operator", start, leading);
      case "&":
        this.pos++;
        if (this.peek() === "&") {
          this.pos++;
        } // `&&`
        return this.token("operator", start, leading);
      case "|":
        this.pos++;
        if (this.peek() === "|") {
          this.pos++; // `||`
          return this.token("operator", start, leading);
        }
        this.error(
          "unexpected-character",
          span(start, this.pos),
          t().syntax.lexer.unexpectedPipe,
        );
        return this.token("error", start, leading);
      case "=":
        this.pos++;
        if (this.peek() === "=") {
          this.pos++;
        } // `==`
        return this.token("operator", start, leading);
      case "<":
        this.pos++;
        if (this.peek() === "=" || this.peek() === ">") {
          this.pos++;
        } // `<=` / `<>`
        return this.token("operator", start, leading);
      case ">":
        this.pos++;
        if (this.peek() === "=") {
          this.pos++;
        } // `>=`
        return this.token("operator", start, leading);
      case "!":
        this.pos++;
        if (this.peek() === "=") {
          this.pos++; // `!=`
          return this.token("operator", start, leading);
        }
        this.error(
          "unexpected-character",
          span(start, this.pos),
          t().syntax.lexer.unexpectedBang,
        );
        return this.token("error", start, leading);
      default: {
        // Consume a full code point so an astral character (emoji) yields one
        // error token with a real hex, not two mojibake surrogate halves.
        const ch = this.peekChar();
        this.pos += ch.length;
        const s = span(start, this.pos);
        const replacement = CONFUSABLE_REPLACEMENTS.get(ch);
        if (replacement !== undefined) {
          this.error(
            "confusable-character",
            s,
            t().syntax.lexer.confusableCharacter(
              ch,
              codePointHex(ch),
              replacement,
            ),
            {
              title: t().syntax.lexer.fixes.replaceWith(replacement),
              edits: [{ span: s, newText: replacement }],
            },
          );
        } else {
          const hex = (ch.codePointAt(0) ?? 0) > 0x7e ? codePointHex(ch) : null;
          this.error(
            "unexpected-character",
            s,
            t().syntax.lexer.unexpectedCharacter(ch, hex),
          );
        }
        return this.token("error", start, leading);
      }
    }
  }
}

function isWhitespace(c: string): boolean {
  return (
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r" ||
    c === "\f" ||
    c === "\v"
  );
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentContinue(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}
