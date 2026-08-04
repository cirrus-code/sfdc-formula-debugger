import { t } from "../i18n/index.ts";
import { lex } from "./lexer.ts";
import { stringClosers } from "./chars.ts";
import { mergeSpans, span, type Span } from "./span.ts";
import type { Diagnostic, DiagnosticCode } from "./diagnostic.ts";
import type { Token } from "./token.ts";
import type {
  BinaryOperator,
  Expr,
  FieldRef,
  FunctionCall,
  Paren,
  UnaryOperator,
} from "./ast.ts";

export interface ParseResult {
  /** Always present; an `ErrorNode` for empty or wholly-unparseable input. */
  readonly ast: Expr;
  /** Lexer + parser diagnostics, merged, in source order. */
  readonly diagnostics: readonly Diagnostic[];
  /** The token stream (drives highlighting even when parsing fails). */
  readonly tokens: readonly Token[];
}

/**
 * Binary operator precedence (higher binds tighter), transcribed from the
 * Salesforce open-source grammar (salesforce/formula-engine `Formula.g4`), which
 * is authoritative — see CONFORMANCE.md. Rule nesting there gives, tightest to
 * loosest: `* /` > `^` > `+ - &` > relational > equality > `&&` > `||`. All are
 * left-associative. Two points that are surprising versus the usual math
 * conventions — `* /` bind tighter than `^`, and `^` is left- (not right-)
 * associative — are org-verified (VERIFICATION.md, probes
 * `syntax:pow_vs_muldiv` / `syntax:pow_assoc`).
 *
 * `&` (concat) shares the additive level with `+`/`-`, so `"x" & 1 + 2` parses
 * as `("x" & 1) + 2`, not `"x" & (1 + 2)`.
 *
 * `&&`/`||` are documented, org-verified product operators; the grammar
 * nests INFIX_OR below INFIX_AND below equality.
 */
export const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  "*": 8,
  "/": 8,
  "^": 7,
  "+": 6,
  "-": 6,
  "&": 6,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "=": 4,
  "<>": 4,
  "==": 4,
  "!=": 4,
  "&&": 3,
  "||": 2,
};

export function parse(source: string): ParseResult {
  const { tokens, diagnostics: lexDiagnostics } = lex(source);
  const parser = new Parser(tokens);
  const ast = parser.parseFormula();
  return {
    ast,
    diagnostics: [...lexDiagnostics, ...parser.diagnostics].sort(
      (a, b) => a.span.start - b.span.start,
    ),
    tokens,
  };
}

/**
 * Recursion budget for nested expressions. parse() must never throw (the
 * editor calls it on every keystroke, unguarded), so pathological nesting —
 * e.g. a pasted blob of thousands of parens — has to be cut off well below
 * the JS stack limit, which browsers can hit around a few thousand frames.
 * Real formulas stay far under this; Salesforce's own compiled-size limit
 * rejects deep nesting long before 500 levels.
 */
const MAX_NESTING_DEPTH = 500;

class Parser {
  readonly diagnostics: Diagnostic[] = [];
  private pos = 0;
  private depth = 0;
  private depthExceeded = false;

  constructor(private readonly tokens: readonly Token[]) {}

  /** Current token. A method, not a getter, so TS re-reads it after advance(). */
  private current(): Token {
    // The stream always ends with an eof token, so this is always defined.
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)]!;
  }

  private peek(offset = 1): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private advance(): Token {
    const t = this.current();
    if (this.current().kind !== "eof") {
      this.pos++;
    }
    return t;
  }

  private error(code: DiagnosticCode, s: Span, message: string): void {
    // Past the nesting cutoff, every unwinding frame would report a missing
    // `)`; the single nesting-too-deep diagnostic already tells the story.
    if (this.depthExceeded) {
      return;
    }
    this.diagnostics.push({ code, severity: "error", span: s, message });
  }

  /** End offset of the most recently consumed token (for synthetic spans). */
  private prevEnd(): number {
    return this.pos > 0 ? this.tokens[this.pos - 1]!.span.end : 0;
  }

  parseFormula(): Expr {
    const expr = this.parseExpr(0);
    if (this.current().kind !== "eof") {
      const start = this.current().span.start;
      let end = this.current().span.end;
      while (this.current().kind !== "eof") {
        end = this.advance().span.end;
      }
      this.error(
        "unexpected-token",
        span(start, end),
        t().syntax.parser.unexpectedTrailingInput,
      );
    }
    return expr;
  }

  // --- Expressions (Pratt) ------------------------------------------------

  private parseExpr(minPrec: number): Expr {
    if (this.depth >= MAX_NESTING_DEPTH) {
      return this.bailTooDeep();
    }
    this.depth++;
    const expr = this.parseExprInner(minPrec);
    this.depth--;
    return expr;
  }

  /** Cut off recursion: report once, consume the rest, return an ErrorNode. */
  private bailTooDeep(): Expr {
    const start = this.current().span.start;
    this.error(
      "nesting-too-deep",
      this.current().span,
      t().syntax.parser.nestingTooDeep,
    );
    this.depthExceeded = true;
    while (this.current().kind !== "eof") {
      this.advance();
    }
    return {
      kind: "ErrorNode",
      span: span(start, Math.max(start, this.prevEnd())),
    };
  }

  private parseExprInner(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      if (this.current().kind !== "operator") {
        break;
      }
      const op = this.current().text as BinaryOperator;
      const prec = BINARY_PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) {
        break;
      }
      const opTok = this.advance();
      // All Salesforce binary operators are left-associative (Formula.g4).
      const right = this.parseExpr(prec + 1);
      left = {
        kind: "BinaryOp",
        op,
        opSpan: opTok.span,
        left,
        right,
        span: mergeSpans(left.span, right.span),
      };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (
      this.current().kind === "operator" &&
      (this.current().text === "-" || this.current().text === "+")
    ) {
      // Sign chains recurse here without re-entering parseExpr, so they need
      // their own depth check (`----…1` would otherwise blow the stack).
      if (this.depth >= MAX_NESTING_DEPTH) {
        return this.bailTooDeep();
      }
      this.depth++;
      const opTok = this.advance();
      const operand = this.parseUnary();
      this.depth--;
      return {
        kind: "UnaryOp",
        op: opTok.text as UnaryOperator,
        opSpan: opTok.span,
        operand,
        span: mergeSpans(opTok.span, operand.span),
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.current();
    switch (tok.kind) {
      case "number":
        this.advance();
        return { kind: "NumberLit", raw: tok.text, span: tok.span };
      case "string":
        this.advance();
        return {
          kind: "StringLit",
          value: decodeString(tok.text),
          raw: tok.text,
          span: tok.span,
        };
      case "true":
      case "false":
        this.advance();
        return {
          kind: "BooleanLit",
          value: tok.kind === "true",
          span: tok.span,
        };
      case "null":
        this.advance();
        return { kind: "NullLit", span: tok.span };
      case "identifier":
        return this.parseIdentifier();
      case "lparen":
        return this.parseParen();
      default:
        return this.parseErrorPrimary();
    }
  }

  private parseIdentifier(): Expr {
    const first = this.current();
    // A bare (non-global) identifier immediately followed by `(` is a call.
    if (!first.text.startsWith("$") && this.peek().kind === "lparen") {
      return this.parseCall();
    }
    return this.parseFieldRef();
  }

  private parseFieldRef(): FieldRef {
    const first = this.advance();
    const path = [first.text];
    const isGlobal = first.text.startsWith("$");
    let end = first.span.end;
    while (this.current().kind === "dot") {
      const dot = this.advance();
      if (this.current().kind === "identifier") {
        path.push(this.current().text);
        end = this.current().span.end;
        this.advance();
      } else {
        this.error(
          "expected-field-name",
          dot.span,
          t().syntax.parser.expectedFieldName,
        );
        end = dot.span.end;
        break;
      }
    }
    return {
      kind: "FieldRef",
      path,
      isGlobal,
      span: span(first.span.start, end),
    };
  }

  private parseCall(): FunctionCall {
    const calleeTok = this.advance(); // identifier
    this.advance(); // `(`
    const args: Expr[] = [];
    while (this.current().kind !== "rparen" && this.current().kind !== "eof") {
      args.push(this.parseExpr(0));
      if (this.current().kind === "comma") {
        const comma = this.advance();
        // `F(a,)` — a trailing comma is a missing argument, recovered the same
        // way as an interior hole (`F(a,,b)`): diagnostic + ErrorNode.
        if (this.current().kind === "rparen" || this.current().kind === "eof") {
          const at = span(comma.span.end, comma.span.end);
          this.error(
            "expected-expression",
            at,
            t().syntax.parser.expectedExpression,
          );
          args.push({ kind: "ErrorNode", span: at });
        }
        continue;
      }
      if (this.current().kind === "rparen" || this.current().kind === "eof") {
        break;
      }
      // Junk between arguments: report once, then resync to a separator.
      this.error(
        "unexpected-token",
        this.current().span,
        t().syntax.parser.expectedArgSeparator,
      );
      this.synchronizeArgs();
      if (this.current().kind === "comma") {
        this.advance();
      }
    }
    let end: number;
    if (this.current().kind === "rparen") {
      end = this.advance().span.end;
    } else {
      const at = span(this.prevEnd(), this.prevEnd());
      this.error(
        "expected-closing-paren",
        at,
        t().syntax.parser.expectedClosingParenForCall,
      );
      end = this.prevEnd();
    }
    return {
      kind: "FunctionCall",
      callee: calleeTok.text,
      calleeSpan: calleeTok.span,
      args,
      span: span(calleeTok.span.start, end),
    };
  }

  private parseParen(): Paren {
    const open = this.advance(); // `(`
    const inner = this.parseExpr(0);
    let end: number;
    if (this.current().kind === "rparen") {
      end = this.advance().span.end;
    } else {
      const at = span(this.prevEnd(), this.prevEnd());
      this.error(
        "expected-closing-paren",
        at,
        t().syntax.parser.expectedClosingParenForGroup,
      );
      end = inner.span.end;
    }
    return { kind: "Paren", expr: inner, span: span(open.span.start, end) };
  }

  private parseErrorPrimary(): Expr {
    const tok = this.current();
    // The eof token is already zero-width, so tok.span works for every kind.
    const at = tok.span;
    this.error("expected-expression", at, t().syntax.parser.expectedExpression);
    // Consume the offending token unless it is a separator the caller needs to
    // see (prevents infinite loops without swallowing structural tokens).
    if (tok.kind !== "eof" && tok.kind !== "comma" && tok.kind !== "rparen") {
      this.advance();
    }
    return { kind: "ErrorNode", span: at };
  }

  /** Skip tokens until a separator or end, for argument-list recovery. */
  private synchronizeArgs(): void {
    while (
      this.current().kind !== "comma" &&
      this.current().kind !== "rparen" &&
      this.current().kind !== "eof"
    ) {
      this.advance();
    }
  }
}

/**
 * Strip surrounding quotes and resolve backslash escapes.
 *
 * The product grammar accepts nine escapes (`\n \r \t \N \R \T \" \' \\`),
 * but the engine collapses only `\\` and `\"`; every other escape keeps both
 * characters — `\n` is a literal backslash-n, never a newline, and `\'` keeps
 * its backslash in both quote styles (oracle-verified: LEN("a\nb") = 4,
 * LEN("\\") = 1, LEN("a\"b") = 3, LEN('a\'b') = 4; VERIFICATION.md, string
 * escapes). Invalid escapes are diagnosed by the lexer and kept verbatim here.
 */
function decodeString(raw: string): string {
  if (raw.length === 0) {
    return "";
  }
  const quote = raw[0]!;
  let body = raw.slice(1);
  // A typographically-quoted token may close with a different character than
  // it opened with (`“abc”`, or `“abc"` when half-fixed) — strip whatever
  // closer the lexer accepted for this opener.
  const closers = stringClosers(quote);
  if (body.length > 0 && closers.includes(body[body.length - 1]!)) {
    body = body.slice(0, -1);
  }
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[++i]!;
      out += next === "\\" || next === '"' ? next : ch + next;
    } else {
      out += ch;
    }
  }
  return out;
}
