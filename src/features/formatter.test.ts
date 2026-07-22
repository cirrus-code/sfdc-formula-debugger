import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  astEqual,
  parse,
  span,
  type BinaryOperator,
  type Expr,
} from "../syntax/index.ts";
import { format, formatExpr } from "./formatter.ts";

const S = span(0, 0);

// A generator of well-formed ASTs (including synthetic paren-free structures the
// simplifier will produce), used to stress the printer's rule-6 guarantees.
const OPS: readonly BinaryOperator[] = [
  "+", "-", "*", "/", "&", "^", "=", "<>", "<", "<=", ">", ">=",
];

const leaf = fc.oneof(
  fc.constantFrom("0", "1", "2.5", "10").map(
    (raw): Expr => ({ kind: "NumberLit", raw, span: S }),
  ),
  fc.constant<Expr>({ kind: "StringLit", value: "s", raw: '"s"', span: S }),
  fc.boolean().map((value): Expr => ({ kind: "BooleanLit", value, span: S })),
  fc.constant<Expr>({ kind: "NullLit", span: S }),
  fc
    .constantFrom(["x"], ["y"], ["Account", "Name"])
    .map((path): Expr => ({ kind: "FieldRef", path, isGlobal: false, span: S })),
);

const astArb: fc.Arbitrary<Expr> = fc.letrec<{ node: Expr }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 4, depthSize: "small" },
    leaf,
    fc
      .record({
        callee: fc.constantFrom("IF", "ABS", "AND", "CONTAINS"),
        args: fc.array(tie("node"), { maxLength: 3 }),
      })
      .map(
        ({ callee, args }): Expr => ({
          kind: "FunctionCall",
          callee,
          calleeSpan: S,
          args,
          span: S,
        }),
      ),
    fc
      .record({ op: fc.constantFrom(...OPS), left: tie("node"), right: tie("node") })
      .map(
        ({ op, left, right }): Expr => ({
          kind: "BinaryOp",
          op,
          opSpan: S,
          left,
          right,
          span: S,
        }),
      ),
    // Only unary "-" — the parser does not synthesize a UnaryOp for a bare "+".
    tie("node").map(
      (operand): Expr => ({
        kind: "UnaryOp",
        op: "-",
        opSpan: S,
        operand,
        span: S,
      }),
    ),
    tie("node").map((expr): Expr => ({ kind: "Paren", expr, span: S })),
  ),
})).node;

function errors(source: string): number {
  return parse(source).diagnostics.filter((d) => d.severity === "error").length;
}

const f = (s: string): string => format(s);

describe("formatter: rule-6 properties over generated ASTs", () => {
  it("prints valid, reparsable source; is idempotent and reparse-equal", () => {
    fc.assert(
      fc.property(astArb, (g) => {
        const src = formatExpr(g);
        // The printer always emits syntactically valid source.
        expect(errors(src)).toBe(0);
        const once = format(src);
        const twice = format(once);
        // Idempotence: a second format is a no-op.
        expect(twice).toBe(once);
        // Reparse-equality: formatting never changes the parsed structure.
        expect(astEqual(parse(once).ast, parse(src).ast)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("formatter: canonical output", () => {
  it("normalizes operator and comma spacing", () => {
    expect(f("1+2*3")).toBe("1 + 2 * 3");
    expect(f("IF(ISBLANK(Amount),0,Amount)")).toBe(
      "IF(ISBLANK(Amount), 0, Amount)",
    );
    expect(f("-1")).toBe("-1");
  });

  it("preserves explicit parentheses", () => {
    expect(f("(1+2)*3")).toBe("(1 + 2) * 3");
    expect(f("1+2*3")).not.toContain("(");
  });

  it("canonicalizes keyword literals", () => {
    expect(f("true")).toBe("TRUE");
    expect(f("null")).toBe("NULL");
  });

  it("breaks a call that exceeds the width, one argument per line", () => {
    const long = `IF(ISBLANK(SomeVeryLongFieldName__c), "a placeholder default", AnotherReasonablyLongField__c)`;
    const out = f(long);
    expect(out.split("\n").length).toBeGreaterThan(1);
    // Still reparses to the same structure.
    expect(astEqual(parse(out).ast, parse(long).ast)).toBe(true);
    // And is idempotent.
    expect(f(out)).toBe(out);
  });

  it("leaves invalid input untouched", () => {
    expect(f("IF(")).toBe("IF(");
    expect(f("1 + ")).toBe("1 + ");
  });

  it("attaches comments in position (leading, before comma/paren, operator, end)", () => {
    expect(f("IF( /* c */ x, 1, 2)")).toBe("IF(/* c */ x, 1, 2)");
    expect(f("IF(a /* c */, b, c)")).toBe("IF(a /* c */, b, c)");
    expect(f("IF(a, b /* c */)")).toBe("IF(a, b /* c */)");
    expect(f("a /* c */ + b")).toBe("a /* c */ + b");
    expect(f("/* head */ ABS(x)")).toBe("/* head */ ABS(x)");
    expect(f("1 + 2 /* tail */")).toBe("1 + 2 /* tail */");
  });
});

const comments = (s: string): string[] => s.match(/\/\*[\s\S]*?\*\//g) ?? [];

describe("formatter: comment preservation (rule 5)", () => {
  const cases = [
    "IF( /*a*/ x, 1, 2)",
    "IF(a /*a*/, b, c)",
    "IF(a, b /*a*/, c)",
    "IF(a, b, c /*a*/)",
    "/*a*/ x + /*b*/ y",
    "x /*a*/ + y /*b*/",
    "ABS( /*a*/ x /*b*/ )",
    "(a /*a*/ + b) * c",
    "1 + 2 /*end*/",
    "/*lead*/ 1",
  ];

  it("preserves every comment, is idempotent, and keeps structure", () => {
    for (const src of cases) {
      const once = f(src);
      // No comment is dropped.
      expect(comments(once).sort()).toEqual(comments(src).sort());
      // Idempotent.
      expect(f(once)).toBe(once);
      // Structure (ignoring trivia) is unchanged.
      expect(astEqual(parse(once).ast, parse(src).ast)).toBe(true);
    }
  });

  it("is idempotent and lossless with a comment injected before any token", () => {
    fc.assert(
      fc.property(astArb, fc.nat(), (g, seed) => {
        const base = formatExpr(g);
        const toks = parse(base).tokens.filter((t) => t.kind !== "eof");
        if (toks.length === 0) {
          return;
        }
        const at = toks[seed % toks.length]!.span.start;
        const withComment = `${base.slice(0, at)}/*c*/${base.slice(at)}`;
        // Skip inputs the injection happened to make invalid.
        if (errors(withComment) > 0) {
          return;
        }
        const once = f(withComment);
        expect(comments(once)).toEqual(["/*c*/"]);
        expect(f(once)).toBe(once);
        expect(astEqual(parse(once).ast, parse(withComment).ast)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });
});
