import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { parse } from "./parser.ts";
import type { BinaryOp, Expr, FieldRef, FunctionCall } from "./ast.ts";

function ast(source: string): Expr {
  return parse(source).ast;
}

function codes(source: string): string[] {
  return parse(source).diagnostics.map((d) => d.code);
}

function expectClean(source: string): Expr {
  const { ast, diagnostics } = parse(source);
  expect(diagnostics).toEqual([]);
  return ast;
}

describe("parser: literals", () => {
  it("parses each literal kind", () => {
    expect(expectClean("42")).toMatchObject({ kind: "NumberLit", raw: "42" });
    expect(expectClean('"hi"')).toMatchObject({
      kind: "StringLit",
      value: "hi",
      raw: '"hi"',
    });
    expect(expectClean("TRUE")).toMatchObject({
      kind: "BooleanLit",
      value: true,
    });
    expect(expectClean("false")).toMatchObject({
      kind: "BooleanLit",
      value: false,
    });
    expect(expectClean("NULL")).toMatchObject({ kind: "NullLit" });
  });

  it("keeps numbers as raw strings (no IEEE float coercion)", () => {
    // Rule 2: 0.1 must not be pre-rounded by the parser.
    expect(expectClean("0.1")).toMatchObject({ kind: "NumberLit", raw: "0.1" });
  });

  it("decodes string escapes", () => {
    expect(ast('"a\\"b"')).toMatchObject({ value: 'a"b' });
    expect(ast('"line\\nbreak"')).toMatchObject({ value: "line\nbreak" });
  });
});

describe("parser: field references", () => {
  it("parses a plain field", () => {
    expect(expectClean("Amount")).toMatchObject({
      kind: "FieldRef",
      path: ["Amount"],
      isGlobal: false,
    });
  });

  it("parses a dotted cross-object path as one flat reference", () => {
    expect(expectClean("Account.Owner.Name")).toMatchObject({
      kind: "FieldRef",
      path: ["Account", "Owner", "Name"],
      isGlobal: false,
    });
  });

  it("flags global references", () => {
    expect(expectClean("$User.Id")).toMatchObject({
      kind: "FieldRef",
      path: ["$User", "Id"],
      isGlobal: true,
    });
  });

  it("parses keyword-prefixed identifiers as fields", () => {
    expect(expectClean("Null_Check__c")).toMatchObject({
      kind: "FieldRef",
      path: ["Null_Check__c"],
    });
  });
});

describe("parser: function calls", () => {
  it("parses a call with arguments", () => {
    const node = expectClean("IF(x, 1, 0)") as FunctionCall;
    expect(node.kind).toBe("FunctionCall");
    expect(node.callee).toBe("IF");
    expect(node.args).toHaveLength(3);
  });

  it("parses a zero-argument call", () => {
    expect(expectClean("TODAY()")).toMatchObject({
      kind: "FunctionCall",
      callee: "TODAY",
      args: [],
    });
  });

  it("parses nested calls", () => {
    const node = expectClean("IF(ISBLANK(x), 0, x)") as FunctionCall;
    expect((node.args[0] as FunctionCall).callee).toBe("ISBLANK");
  });
});

describe("parser: operators and precedence", () => {
  it("binds * tighter than +", () => {
    const node = expectClean("1 + 2 * 3") as BinaryOp;
    expect(node.op).toBe("+");
    expect((node.right as BinaryOp).op).toBe("*");
  });

  it("binds comparison tighter than equality", () => {
    // a < b = c  ->  (a < b) = c
    const node = expectClean("a < b = c") as BinaryOp;
    expect(node.op).toBe("=");
    expect((node.left as BinaryOp).op).toBe("<");
  });

  // Precedence/associativity below is transcribed from salesforce/formula-engine
  // Formula.g4 (see CONFORMANCE.md), not from math intuition.

  it("binds * and / tighter than ^ (per SF grammar)", () => {
    // 2 * 3 ^ 4  ->  (2 * 3) ^ 4
    const node = expectClean("2 * 3 ^ 4") as BinaryOp;
    expect(node.op).toBe("^");
    expect((node.left as BinaryOp).op).toBe("*");
  });

  it("treats ^ as left-associative (per SF grammar)", () => {
    // 2 ^ 3 ^ 2  ->  (2 ^ 3) ^ 2
    const node = expectClean("2 ^ 3 ^ 2") as BinaryOp;
    expect(node.op).toBe("^");
    expect((node.left as BinaryOp).op).toBe("^");
  });

  it("puts & at the additive level, left-associative (per SF grammar)", () => {
    // "x" & 1 + 2  ->  ("x" & 1) + 2
    const node = expectClean('"x" & 1 + 2') as BinaryOp;
    expect(node.op).toBe("+");
    expect((node.left as BinaryOp).op).toBe("&");
  });

  it("treats & as left-associative", () => {
    const node = expectClean('"a" & "b" & "c"') as BinaryOp;
    expect((node.left as BinaryOp).op).toBe("&"); // (a & b) & c
  });

  it("parses unary minus", () => {
    expect(expectClean("-x")).toMatchObject({ kind: "UnaryOp", op: "-" });
  });

  it("preserves parentheses as nodes", () => {
    const node = expectClean("(1 + 2)");
    expect(node.kind).toBe("Paren");
  });
});

describe("parser: error recovery", () => {
  it("never throws and always returns an AST", () => {
    for (const src of [
      "",
      "(",
      ")",
      "IF(",
      ",",
      "1 +",
      "@",
      "1 2 3",
      "a.",
      "* 5",
    ]) {
      expect(() => parse(src)).not.toThrow();
      expect(parse(src).ast).toBeTruthy();
    }
  });

  it("returns an ErrorNode with a diagnostic for empty input", () => {
    const { ast, diagnostics } = parse("");
    expect(ast.kind).toBe("ErrorNode");
    expect(diagnostics.map((d) => d.code)).toEqual(["expected-expression"]);
  });

  it("recovers an unclosed group into a Paren node", () => {
    const { ast, diagnostics } = parse("(1 + 2");
    expect(ast.kind).toBe("Paren");
    expect(diagnostics.map((d) => d.code)).toContain("expected-closing-paren");
  });

  it("recovers an unclosed call, keeping parsed arguments", () => {
    const { ast, diagnostics } = parse("IF(a, b");
    const call = ast as FunctionCall;
    expect(call.kind).toBe("FunctionCall");
    expect(call.args).toHaveLength(2);
    expect(diagnostics.map((d) => d.code)).toContain("expected-closing-paren");
  });

  it("reports a dangling dot in a field path", () => {
    const { ast, diagnostics } = parse("Account.");
    expect((ast as FieldRef).path).toEqual(["Account"]);
    expect(diagnostics.map((d) => d.code)).toContain("expected-field-name");
  });

  it("reports a missing operand", () => {
    expect(codes("1 +")).toContain("expected-expression");
  });

  it("recovers from junk between arguments without losing the call", () => {
    const { ast, diagnostics } = parse("IF(a b, c)");
    expect(ast.kind).toBe("FunctionCall");
    expect(diagnostics.map((d) => d.code)).toContain("unexpected-token");
  });

  it("reports trailing input after a complete expression", () => {
    expect(codes("1 2")).toContain("unexpected-token");
  });

  it("positions the unclosed-paren diagnostic at end of input", () => {
    const { diagnostics } = parse("(1");
    const d = diagnostics.find((x) => x.code === "expected-closing-paren")!;
    expect(d.span.start).toBe(2);
  });

  it("suppresses cascading errors inside an error region", () => {
    // A single bad token should not spray diagnostics across the whole formula.
    expect(codes("@").length).toBeLessThanOrEqual(2);
  });
});

describe("parser: properties", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (source) => {
        expect(() => parse(source)).not.toThrow();
      }),
    );
  });

  it("never throws on formula-shaped input and always yields an AST", () => {
    const piece = fc.constantFrom(
      "IF",
      "AND",
      "(",
      ")",
      ",",
      "x",
      "Account.Name",
      "$User.Id",
      "1",
      "2.5",
      '"s"',
      "+",
      "-",
      "*",
      "/",
      "&",
      "=",
      "<>",
      "^",
      " ",
      "TRUE",
      "NULL",
    );
    fc.assert(
      fc.property(
        fc.array(piece).map((ps) => ps.join("")),
        (source) => {
          const r = parse(source);
          expect(r.ast).toBeTruthy();
        },
      ),
    );
  });
});
