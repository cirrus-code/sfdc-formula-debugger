import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { lex } from "./lexer.ts";
import { tokensToSource, type Token, type TokenKind } from "./token.ts";

/** Token (kind, text) pairs excluding the trailing eof, for compact assertions. */
function kinds(source: string): Array<[TokenKind, string]> {
  return lex(source)
    .tokens.filter((t) => t.kind !== "eof")
    .map((t) => [t.kind, t.text]);
}

function only(source: string): Token {
  const toks = lex(source).tokens.filter((t) => t.kind !== "eof");
  expect(toks).toHaveLength(1);
  return toks[0]!;
}

describe("lexer: structure", () => {
  it("always terminates with exactly one eof token", () => {
    const { tokens } = lex("1 + 2");
    expect(tokens.at(-1)!.kind).toBe("eof");
    expect(tokens.filter((t) => t.kind === "eof")).toHaveLength(1);
  });

  it("emits an eof token even for empty input", () => {
    const { tokens, diagnostics } = lex("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.kind).toBe("eof");
    expect(diagnostics).toHaveLength(0);
  });

  it("records accurate spans", () => {
    const amp = only("&");
    expect(amp.span).toEqual({ start: 0, end: 1 });
    const [a, plus] = lex("ab+").tokens;
    expect(a!.span).toEqual({ start: 0, end: 2 });
    expect(plus!.span).toEqual({ start: 2, end: 3 });
  });
});

describe("lexer: numbers", () => {
  it("lexes integers and decimals", () => {
    expect(kinds("123")).toEqual([["number", "123"]]);
    expect(kinds("1.5")).toEqual([["number", "1.5"]]);
    expect(kinds(".5")).toEqual([["number", ".5"]]);
  });

  it("does not absorb a trailing dot into the number", () => {
    expect(kinds("1.")).toEqual([
      ["number", "1"],
      ["dot", "."],
    ]);
  });
});

describe("lexer: identifiers and keywords", () => {
  it("recognizes TRUE/FALSE/NULL case-insensitively as complete tokens", () => {
    expect(only("TRUE").kind).toBe("true");
    expect(only("true").kind).toBe("true");
    expect(only("False").kind).toBe("false");
    expect(only("nUlL").kind).toBe("null");
  });

  it("does not treat keyword-prefixed identifiers as keywords", () => {
    // Known formulon grammar bug we must NOT replicate (CLAUDE.md).
    expect(only("Null_Check__c").kind).toBe("identifier");
    expect(only("TRUEFIELD__c").kind).toBe("identifier");
    expect(only("FALSEHOOD").kind).toBe("identifier");
  });

  it("lexes underscores and custom-field suffixes", () => {
    expect(only("Account_Name__c").text).toBe("Account_Name__c");
    expect(only("ns__Field__r").text).toBe("ns__Field__r");
  });

  it("splits dotted cross-object paths into identifier/dot/identifier", () => {
    expect(kinds("Account.Owner.Name")).toEqual([
      ["identifier", "Account"],
      ["dot", "."],
      ["identifier", "Owner"],
      ["dot", "."],
      ["identifier", "Name"],
    ]);
  });
});

describe("lexer: globals", () => {
  it("lexes $-prefixed globals as a single identifier", () => {
    expect(kinds("$User.Id")).toEqual([
      ["identifier", "$User"],
      ["dot", "."],
      ["identifier", "Id"],
    ]);
  });

  it("never treats a global as a keyword", () => {
    expect(only("$True").kind).toBe("identifier");
  });

  it("emits an error token for a lone $", () => {
    const { tokens, diagnostics } = lex("$");
    expect(tokens[0]!.kind).toBe("error");
    expect(diagnostics[0]!.code).toBe("unexpected-character");
  });
});

describe("lexer: strings", () => {
  it("lexes single- and double-quoted strings", () => {
    expect(only('"abc"').text).toBe('"abc"');
    expect(only("'abc'").text).toBe("'abc'");
  });

  it("keeps escaped quotes inside the string", () => {
    expect(only('"a\\"b"').text).toBe('"a\\"b"');
  });

  it("reports an unterminated string but still emits the token", () => {
    const { tokens, diagnostics } = lex('"abc');
    expect(tokens[0]!.kind).toBe("string");
    expect(tokens[0]!.text).toBe('"abc');
    expect(diagnostics[0]!.code).toBe("unterminated-string");
  });
});

describe("lexer: operators", () => {
  it("lexes multi-character operators greedily", () => {
    expect(kinds("<> <= >= == != = < > + - * / ^ &")).toEqual(
      [
        "<>",
        "<=",
        ">=",
        "==",
        "!=",
        "=",
        "<",
        ">",
        "+",
        "-",
        "*",
        "/",
        "^",
        "&",
      ].map((t) => ["operator", t] as [TokenKind, string]),
    );
  });

  it("lexes a lone ! as an error token", () => {
    const { tokens, diagnostics } = lex("!");
    expect(tokens[0]!.kind).toBe("error");
    expect(diagnostics[0]!.code).toBe("unexpected-character");
  });
});

describe("lexer: trivia and comments", () => {
  it("attaches leading whitespace to the following token", () => {
    const { tokens } = lex("  1");
    expect(tokens[0]!.kind).toBe("number");
    expect(tokens[0]!.leadingTrivia).toEqual([
      { kind: "whitespace", text: "  ", span: { start: 0, end: 2 } },
    ]);
  });

  it("treats block comments as trivia attached to the next token", () => {
    const { tokens, diagnostics } = lex("/* note */ 1");
    expect(diagnostics).toHaveLength(0);
    const num = tokens[0]!;
    expect(num.kind).toBe("number");
    expect(num.leadingTrivia.map((t) => t.kind)).toEqual([
      "comment",
      "whitespace",
    ]);
    expect(num.leadingTrivia[0]!.text).toBe("/* note */");
  });

  it("attaches trailing trivia to the eof token", () => {
    const { tokens } = lex("1 /* end */");
    const eof = tokens.at(-1)!;
    expect(eof.kind).toBe("eof");
    expect(eof.leadingTrivia.map((t) => t.kind)).toEqual([
      "whitespace",
      "comment",
    ]);
  });

  it("reports an unterminated comment", () => {
    const { diagnostics } = lex("/* open");
    expect(diagnostics[0]!.code).toBe("unterminated-comment");
  });
});

describe("lexer: error recovery", () => {
  it("emits an error token for unknown characters and keeps going", () => {
    const { tokens, diagnostics } = lex("1 @ 2");
    expect(tokens.filter((t) => t.kind !== "eof").map((t) => t.kind)).toEqual([
      "number",
      "error",
      "number",
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("unexpected-character");
  });
});

describe("lexer: properties", () => {
  it("is lossless: re-concatenating tokens + trivia yields the source", () => {
    fc.assert(
      fc.property(fc.string(), (source) => {
        expect(tokensToSource(lex(source).tokens)).toBe(source);
      }),
    );
  });

  it("is lossless over formula-shaped input", () => {
    const piece = fc.constantFrom(
      "IF",
      "Account.Name",
      "$User.Id",
      "1.5",
      '"txt"',
      "/* c */",
      "<>",
      "&",
      " ",
      "(",
      ")",
      ",",
      "TRUE",
      "Null_Check__c",
    );
    fc.assert(
      fc.property(
        fc.array(piece).map((ps) => ps.join("")),
        (source) => {
          expect(tokensToSource(lex(source).tokens)).toBe(source);
        },
      ),
    );
  });

  it("never throws on any input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (source) => {
        expect(() => lex(source)).not.toThrow();
      }),
    );
  });
});
