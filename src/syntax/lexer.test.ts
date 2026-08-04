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
    // Known formulon grammar bug we must NOT replicate: identifiers may begin
    // with keyword-like prefixes.
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

describe("lexer: && / || operators (org-verified)", () => {
  it("lexes && and || as single operator tokens", () => {
    expect(kinds("a && b")).toEqual([
      ["identifier", "a"],
      ["operator", "&&"],
      ["identifier", "b"],
    ]);
    expect(kinds("a || b")).toEqual([
      ["identifier", "a"],
      ["operator", "||"],
      ["identifier", "b"],
    ]);
  });

  it("still lexes a single & as the concat operator", () => {
    expect(kinds('"a" & "b"')).toEqual([
      ["string", '"a"'],
      ["operator", "&"],
      ["string", '"b"'],
    ]);
  });

  it("errors on a lone |", () => {
    const { tokens, diagnostics } = lex("a | b");
    expect(tokens.some((t) => t.kind === "error")).toBe(true);
    expect(diagnostics.some((d) => d.code === "unexpected-character")).toBe(
      true,
    );
  });
});

describe("lexer: nested comment warning (org-verified: comments do not nest)", () => {
  it("warns on an inner /* — the first */ closes the comment", () => {
    const { diagnostics } = lex("1 /* a /* b */ + 2");
    const nested = diagnostics.filter((d) => d.code === "nested-comment");
    expect(nested).toHaveLength(1);
    expect(nested[0]!.severity).toBe("warning");
  });

  it("stays silent for ordinary comments", () => {
    expect(lex("1 /* plain */ + 2").diagnostics).toHaveLength(0);
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

describe("lexer: pasted invisible characters", () => {
  it("recovers a zero-width space between tokens as invisible trivia with a removal fix", () => {
    const source = "1\u200B+2";
    const { tokens, diagnostics } = lex(source);
    const toks = tokens.filter((t) => t.kind !== "eof");
    expect(toks.map((t) => [t.kind, t.text])).toEqual([
      ["number", "1"],
      ["operator", "+"],
      ["number", "2"],
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("invisible-character");
    expect(diagnostics[0]!.span).toEqual({ start: 1, end: 2 });
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 1, end: 2 }, newText: "" },
    ]);
    expect(toks[1]!.leadingTrivia.map((tr) => tr.kind)).toContain("invisible");
    expect(tokensToSource(tokens)).toBe(source);
  });

  it("collapses a doubled run of zero-width spaces into one diagnostic covering both", () => {
    const source = "IF(\u200B\u200B1, 2, 3)";
    const { diagnostics } = lex(source);
    const invisible = diagnostics.filter(
      (d) => d.code === "invisible-character",
    );
    expect(invisible).toHaveLength(1);
    const d = invisible[0]!;
    expect(d.span.end - d.span.start).toBe(2);
    expect(d.fix?.edits).toEqual([{ span: d.span, newText: "" }]);
  });

  it("recovers a non-breaking space as nonstandard whitespace with a space-replacement fix", () => {
    const source = "1\u00A0+ 2";
    const { diagnostics } = lex(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("nonstandard-whitespace");
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: diagnostics[0]!.span, newText: " " },
    ]);
  });

  it("replaces a run of non-breaking spaces with an equal-length run of regular spaces", () => {
    const source = "1\u00A0\u00A0+2";
    const { diagnostics } = lex(source);
    const nonstd = diagnostics.filter(
      (d) => d.code === "nonstandard-whitespace",
    );
    expect(nonstd).toHaveLength(1);
    expect(nonstd[0]!.fix?.edits).toEqual([
      { span: nonstd[0]!.span, newText: "  " },
    ]);
  });

  it("treats adjacent runs of different paste characters as separate diagnostics", () => {
    const source = "\u200B\u00A01";
    const { diagnostics } = lex(source);
    expect(diagnostics.map((d) => d.code)).toEqual([
      "invisible-character",
      "nonstandard-whitespace",
    ]);
    expect(diagnostics[0]!.span).toEqual({ start: 0, end: 1 });
    expect(diagnostics[1]!.span).toEqual({ start: 1, end: 2 });
  });

  it("splits an identifier around a pasted invisible character", () => {
    expect(kinds("ISPICK\u200BVAL")).toEqual([
      ["identifier", "ISPICK"],
      ["identifier", "VAL"],
    ]);
    const { diagnostics } = lex("ISPICK\u200BVAL");
    expect(diagnostics.map((d) => d.code)).toEqual(["invisible-character"]);
  });

  it("recovers a leading byte-order mark as invisible trivia", () => {
    const { tokens, diagnostics } = lex("\uFEFF1");
    const toks = tokens.filter((t) => t.kind !== "eof");
    expect(toks.map((t) => [t.kind, t.text])).toEqual([["number", "1"]]);
    expect(diagnostics.map((d) => d.code)).toEqual(["invisible-character"]);
    expect(diagnostics[0]!.span).toEqual({ start: 0, end: 1 });
  });

  it("does not diagnose an invisible character inside a comment", () => {
    expect(lex("/* \u200B */1").diagnostics).toEqual([]);
  });
});

describe("lexer: confusable characters", () => {
  it("lexes a smart-quoted string as one token with a straighten-both-quotes fix", () => {
    const source = "\u201Cabc\u201D";
    const tok = only(source);
    expect(tok.kind).toBe("string");
    expect(tok.text).toBe(source);
    const { diagnostics } = lex(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("confusable-character");
    expect(diagnostics[0]!.span).toEqual({ start: 0, end: source.length });
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: '"' },
      { span: { start: source.length - 1, end: source.length }, newText: '"' },
    ]);
  });

  it("gives a half-fixed smart string (straight closer already typed) one edit, for the opener only", () => {
    const source = '\u201Cabc"';
    const tok = only(source);
    expect(tok.kind).toBe("string");
    expect(tok.text).toBe(source);
    const { diagnostics } = lex(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: '"' },
    ]);
  });

  it("lexes a standalone unpaired curly apostrophe as a confusable error token", () => {
    const { tokens, diagnostics } = lex("\u2019");
    expect(tokens[0]!.kind).toBe("error");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("confusable-character");
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: "'" },
    ]);
  });

  it("maps a confusable dash to a plain hyphen-minus", () => {
    const { diagnostics } = lex("1 \u2013 2");
    const dash = diagnostics.find((d) => d.code === "confusable-character")!;
    expect(dash).toBeDefined();
    expect(dash.fix?.edits).toEqual([{ span: dash.span, newText: "-" }]);
  });

  it("maps the multiplication sign to *", () => {
    const { diagnostics } = lex("\u00D7");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("confusable-character");
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: "*" },
    ]);
  });

  it("maps a fullwidth paren to its ASCII replacement", () => {
    const { diagnostics } = lex("\uFF08");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("confusable-character");
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: "(" },
    ]);
  });

  it("maps the division sign to /", () => {
    const { diagnostics } = lex("\u00F7");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("confusable-character");
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: "/" },
    ]);
  });

  it("places the closer fix correctly when escapes precede the smart closer", () => {
    // \\n is a two-character escape the scanner steps over; the closer's fix
    // span must land on the closer itself, not drift into the escape.
    const source = '\u201Ca\\n b\u201D';
    const tok = only(source);
    expect(tok.kind).toBe("string");
    const { diagnostics } = lex(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.fix?.edits).toEqual([
      { span: { start: 0, end: 1 }, newText: '"' },
      { span: { start: source.length - 1, end: source.length }, newText: '"' },
    ]);
  });

  it("diagnoses only the delimiters, not an invisible character inside a smart-quoted string", () => {
    const { diagnostics } = lex("\u201Ca\u200Bb\u201D");
    expect(diagnostics.map((d) => d.code)).toEqual(["confusable-character"]);
  });

  it("does not diagnose an invisible character inside a straight-quoted string", () => {
    const source = '"a\u200Bb"';
    const { tokens, diagnostics } = lex(source);
    expect(diagnostics).toEqual([]);
    expect(tokens[0]!.kind).toBe("string");
    expect(tokens[0]!.text).toBe(source);
  });

  it("lexes an astral character as one error token with one diagnostic", () => {
    const source = "\uD83C\uDF89"; // U+1F389 PARTY POPPER
    const { tokens, diagnostics } = lex(source);
    const toks = tokens.filter((t) => t.kind !== "eof");
    expect(toks).toHaveLength(1);
    expect(toks[0]!.kind).toBe("error");
    expect(toks[0]!.text).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("unexpected-character");
    expect(diagnostics[0]!.span).toEqual({ start: 0, end: 2 });
  });

  it("keeps a curly quote inside a straight-quoted string as legal content", () => {
    const source = '"a\u201Db"';
    const tok = only(source);
    expect(tok.kind).toBe("string");
    expect(tok.text).toBe(source);
    expect(lex(source).diagnostics).toEqual([]);
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
      "\u200B",
      "\u00A0",
      "\u201Cq\u201D",
      "\u2013",
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
