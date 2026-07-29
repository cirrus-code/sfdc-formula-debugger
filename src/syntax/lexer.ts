import { t } from "../i18n/index.ts";
import { span, type Span } from "./span.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type { LexResult, Token, TokenKind, Trivia } from "./token.ts";

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

  private error(code: Diagnostic["code"], s: Span, message: string): void {
    this.diagnostics.push({ code, severity: "error", span: s, message });
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
        break;
      }
    }
    return trivia;
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

    if (c === '"' || c === "'") {
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

  private scanString(start: number, leading: readonly Trivia[]): Token {
    const quote = this.peek();
    this.pos++; // opening quote
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
      if (c === quote) {
        break;
      }
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
      default:
        this.pos++;
        this.error(
          "unexpected-character",
          span(start, this.pos),
          t().syntax.lexer.unexpectedCharacter(c),
        );
        return this.token("error", start, leading);
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
