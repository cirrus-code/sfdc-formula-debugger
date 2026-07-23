import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { span, type BinaryOperator, type Expr } from "../syntax/index.ts";
import { formatExpr } from "./formatter.ts";
import {
  Decimal,
  evaluateFormula,
  isError,
  type EvalResult,
  type SfValue,
} from "../engine/index.ts";
import { simplify, simplifySource } from "./simplifier.ts";

/** Simplify a source string; asserts it parses (all fixtures are valid). */
function s(source: string) {
  const result = simplifySource(source);
  expect(result, `expected "${source}" to parse`).not.toBeNull();
  return result!;
}

const out = (source: string): string => s(source).formatted;
const rules = (source: string): string[] => s(source).steps.map((x) => x.rule);
const suggested = (source: string): string[] =>
  s(source).suggestions.map((x) => x.rule);

describe("simplifier: applied rewrites", () => {
  it("folds constant subexpressions via the real evaluator", () => {
    expect(out("1 + 2")).toBe("3");
    expect(out("NOT(1 = 1)")).toBe("FALSE");
    expect(out('LEN("hello")')).toBe("5");
    expect(out("IF(2 > 1, Amount, 0)")).toBe("Amount");
    expect(out("0 - 1")).toBe("-1");
  });

  it("does not fold when the literal would be longer, error, or blank", () => {
    // 1/3 at 32 places is not a simplification.
    expect(out("1 / 3")).toBe("1 / 3");
    // A visible #Error! must stay visible.
    expect(out("IF(1 / 0 = 1, A, B)")).toBe("IF(1 / 0 = 1, A, B)");
    // NULL literals are blank-mode territory; leave them alone.
    expect(out("1 + NULL")).toBe("1 + NULL");
  });

  it("takes literal IF branches, including a NULL condition", () => {
    expect(out("IF(TRUE, A, B)")).toBe("A");
    expect(out("IF(FALSE, A, B)")).toBe("B");
    expect(out("IF(NULL, A, B)")).toBe("B");
  });

  it("collapses boolean-shaped IF only over provably non-blank conditions", () => {
    expect(out("IF(ISBLANK(A), TRUE, FALSE)")).toBe("ISBLANK(A)");
    expect(out("IF(ISBLANK(A), FALSE, TRUE)")).toBe("NOT(ISBLANK(A))");
    // A bare field can be blank: blank coerces to FALSE inside IF but would
    // resurface as blank on its own. Must not rewrite — suggestion instead.
    expect(out("IF(IsWon__c, TRUE, FALSE)")).toBe("IF(IsWon__c, TRUE, FALSE)");
    expect(suggested("IF(IsWon__c, TRUE, FALSE)")).toContain(
      "boolean-shaped-if",
    );
  });

  it("cancels double negation only over boolean-typed operands", () => {
    expect(out("NOT(NOT(ISBLANK(A)))")).toBe("ISBLANK(A)");
    expect(out("NOT(NOT(A = B))")).toBe("A = B");
    // A bare field might not even be a Boolean; the rewrite would change type.
    expect(out("NOT(NOT(F__c))")).toBe("NOT(NOT(F__c))");
  });

  it("turns a negated equality into the opposite comparator", () => {
    expect(out("NOT(A = B)")).toBe("A <> B");
    expect(out("NOT(A <> B)")).toBe("A = B");
    // Orderings are NOT flipped (blank breaks it) — suggestion only.
    expect(out("NOT(A < B)")).toBe("NOT(A < B)");
    expect(suggested("NOT(A < B)")).toContain("ordering-negation");
  });

  it("flattens nested AND/OR", () => {
    expect(out("AND(AND(A, B), C)")).toBe("AND(A, B, C)");
    expect(out("OR(A, OR(B, C))")).toBe("OR(A, B, C)");
  });

  it("drops identity literals from AND/OR", () => {
    expect(out("AND(A, TRUE, B)")).toBe("AND(A, B)");
    expect(out("OR(A, FALSE, B)")).toBe("OR(A, B)");
    // Collapse to a single argument needs the non-blank proof.
    expect(out("AND(ISBLANK(A), TRUE)")).toBe("ISBLANK(A)");
    expect(out("AND(F__c, TRUE)")).toBe("AND(F__c, TRUE)");
  });

  it("truncates unreachable arguments after a short-circuiting literal", () => {
    expect(out("AND(A, FALSE, B)")).toBe("AND(A, FALSE)");
    expect(out("OR(A, TRUE, B)")).toBe("OR(A, TRUE)");
    // A leading literal decides the whole call — nothing before it can error.
    expect(out("AND(FALSE, A)")).toBe("FALSE");
    expect(out("OR(TRUE, A)")).toBe("TRUE");
    // The 2-arg annihilator must NOT be folded (x could raise #Error!).
    expect(out("AND(A, FALSE)")).toBe("AND(A, FALSE)");
    expect(suggested("AND(A, FALSE)")).toContain("annihilator");
  });

  it("drops repeated and absorbed arguments", () => {
    expect(out("AND(A, B, A)")).toBe("AND(A, B)");
    expect(out("OR(A, B, OR(A, C))")).not.toContain("OR(A, C)");
    expect(out("AND(A, OR(A, B), C)")).toBe("AND(A, C)");
    expect(out("OR(A, AND(A, B), C)")).toBe("OR(A, C)");
    // Absorption only when the shared term LEADS the inner call — otherwise
    // the inner call's earlier arguments could error before short-circuiting.
    expect(out("AND(A, OR(B, A), C)")).toBe("AND(A, OR(B, A), C)");
  });

  it("removes redundant parentheses but keeps meaningful ones", () => {
    expect(out("(A)")).toBe("A");
    expect(out("(A * B) + C")).toBe("A * B + C");
    expect(out("IF((A), 1, 2)")).toBe("IF(A, 1, 2)");
    expect(out("(A + B) * C")).toBe("(A + B) * C");
    expect(rules("(A * B) + C")).toEqual(["redundant-parens"]);
  });
});

describe("simplifier: unsafe classical laws are demoted to suggestions", () => {
  it("does not apply De Morgan (blank breaks it) but suggests it", () => {
    const src = "AND(NOT(A), NOT(B))";
    expect(out(src)).toBe(src);
    const sugg = s(src).suggestions.find((x) => x.rule === "de-morgan");
    expect(sugg).toBeDefined();
    expect(sugg!.message).toContain("NOT(OR(A, B))");
    expect(sugg!.message).toContain("blank");
  });

  it("suggests CASE for an IF chain over one subject, once", () => {
    const src =
      'IF(Stage__c = "A", 1, IF(Stage__c = "B", 2, IF(Stage__c = "C", 3, 0)))';
    const suggs = s(src).suggestions.filter((x) => x.rule === "case-chain");
    expect(suggs).toHaveLength(1);
    expect(suggs[0]!.message).toContain(
      'CASE(Stage__c, "A", 1, "B", 2, "C", 3, 0)',
    );
  });

  it("does not suggest CASE for chains over different subjects", () => {
    const src = 'IF(A__c = "x", 1, IF(B__c = "y", 2, 0))';
    expect(suggested(src)).not.toContain("case-chain");
  });
});

describe("simplifier: step log and fixpoint", () => {
  it("logs each rewrite with whole-formula before/after", () => {
    const result = s("NOT(NOT(ISBLANK(A)))");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.before).toBe("NOT(NOT(ISBLANK(A)))");
    expect(result.steps[0]!.after).toBe("ISBLANK(A)");
    expect(result.steps[0]!.title).not.toBe("");
  });

  it("cascades rules and reaches a fixpoint", () => {
    const result = s("AND(AND(A, TRUE), NOT(1 = 2), A)");
    // flatten → drop TRUE → dedup A → fold NOT(1=2)→TRUE. The final TRUE stays:
    // collapsing AND(A, TRUE) to A would turn a blank A into FALSE.
    expect(result.formatted).toBe("AND(A, TRUE)");
    // Re-simplifying the output is a no-op.
    const again = simplify(result.ast);
    expect(again.steps).toHaveLength(0);
    expect(again.formatted).toBe(result.formatted);
  });

  it("returns null for syntactically invalid input", () => {
    expect(simplifySource("IF(")).toBeNull();
  });
});

// --- rule 7 enforcement: equivalence under the real evaluator -------------

const S = span(0, 0);
const ref = (name: string): Expr => ({
  kind: "FieldRef",
  path: [name],
  isGlobal: false,
  span: S,
});
const numLit = (raw: string): Expr => ({ kind: "NumberLit", raw, span: S });
const boolLit = (value: boolean): Expr => ({
  kind: "BooleanLit",
  value,
  span: S,
});
const call = (callee: string, ...args: Expr[]): Expr => ({
  kind: "FunctionCall",
  callee,
  calleeSpan: S,
  args,
  span: S,
});
const bin = (op: BinaryOperator, left: Expr, right: Expr): Expr => ({
  kind: "BinaryOp",
  op,
  opSpan: S,
  left,
  right,
  span: S,
});

// Boolean-yielding leaves, deliberately including blank-prone comparisons and
// an error-prone division (M can be zero).
const boolLeaf: fc.Arbitrary<Expr> = fc.oneof(
  fc.boolean().map(boolLit),
  fc.constant<Expr>({ kind: "NullLit", span: S }),
  fc.constantFrom(ref("A"), ref("B")),
  fc.constantFrom<Expr>(
    bin("<", ref("N"), ref("M")),
    bin("=", ref("N"), ref("M")),
    bin("=", ref("N"), numLit("0")),
    bin(">=", ref("M"), numLit("1")),
    bin(">", bin("/", ref("N"), ref("M")), numLit("1")), // errors when M = 0
    bin("=", ref("S"), { kind: "StringLit", value: "x", raw: '"x"', span: S }),
    call("ISBLANK", ref("N")),
    call("ISBLANK", ref("S")),
  ),
);

const boolAst: fc.Arbitrary<Expr> = fc.letrec<{ node: Expr }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 4, depthSize: "small" },
    boolLeaf,
    fc
      .array(tie("node"), { minLength: 2, maxLength: 3 })
      .map((args) => call("AND", ...args)),
    fc
      .array(tie("node"), { minLength: 2, maxLength: 3 })
      .map((args) => call("OR", ...args)),
    tie("node").map((x) => call("NOT", x)),
    fc
      .tuple(tie("node"), tie("node"), tie("node"))
      .map(([c, t, f]) => call("IF", c, t, f)),
    tie("node").map((x): Expr => ({ kind: "Paren", expr: x, span: S })),
  ),
})).node;

const bools = fc.constantFrom<SfValue>(
  { type: "Boolean", blank: false, data: true },
  { type: "Boolean", blank: false, data: false },
  { type: "Boolean", blank: true, data: false },
);
const nums = fc.constantFrom<SfValue>(
  { type: "Number", blank: false, data: new Decimal(0) },
  { type: "Number", blank: false, data: new Decimal(1) },
  { type: "Number", blank: false, data: new Decimal("2.5") },
  { type: "Number", blank: true, data: new Decimal(0) },
);
const texts = fc.constantFrom<SfValue>(
  { type: "Text", blank: false, data: "" },
  { type: "Text", blank: false, data: "x" },
  { type: "Text", blank: true, data: "" },
);

const envArb = fc
  .record({
    A: bools,
    B: bools,
    N: nums,
    M: nums,
    S: texts,
    blankMode: fc.constantFrom("zero" as const, "blank" as const),
  })
  .map(({ blankMode, ...fields }) => ({
    fields: new Map(Object.entries(fields)),
    blankMode,
  }));

/** Same simulated outcome: same error-ness, blankness, type, and data. */
function sameResult(a: EvalResult, b: EvalResult): boolean {
  if (isError(a) || isError(b)) {
    return isError(a) && isError(b);
  }
  if (a.blank || b.blank) {
    return a.blank === b.blank;
  }
  if (a.type !== b.type) {
    return false;
  }
  if (a.data instanceof Decimal && b.data instanceof Decimal) {
    return a.data.equals(b.data);
  }
  return a.data === b.data;
}

describe("simplifier: rule-7 property — rewrites preserve engine semantics", () => {
  it("original and simplified agree over random inputs, blanks, both modes", () => {
    fc.assert(
      fc.property(boolAst, envArb, (ast, env) => {
        const simplified = simplify(ast).ast;
        const before = evaluateFormula(ast, env);
        const after = evaluateFormula(simplified, env);
        if (!sameResult(before, after)) {
          throw new Error(
            `rewrite changed behavior\n  original:   ${formatExpr(ast)}\n` +
              `  simplified: ${formatExpr(simplified)}\n` +
              `  env: ${JSON.stringify([...env.fields], null, 0)} mode=${env.blankMode}\n` +
              `  before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          );
        }
      }),
      { numRuns: 500 },
    );
  });
});
