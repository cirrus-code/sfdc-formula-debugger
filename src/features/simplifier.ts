import {
  astEqual,
  parse,
  type BinaryOp,
  type Expr,
  type FunctionCall,
  type Span,
} from "../syntax/index.ts";
import {
  evaluateFormula,
  isError,
  UnsupportedError,
  type SfValue,
} from "../engine/index.ts";
import { t } from "../i18n/index.ts";
import { formatExpr, needsParens } from "./formatter.ts";

/**
 * Boolean simplifier (DESIGN §8.2): a pipeline of AST rewrite rules applied to
 * fixpoint, with a step log the UI renders as a before → after transformation.
 *
 * Every applied rewrite is equivalence-preserving under the engine's verified
 * Salesforce semantics — which are NOT classical boolean
 * algebra. The evaluator coerces blank to FALSE inside AND/OR/IF conditions,
 * propagates blank through NOT, short-circuits AND/OR left-to-right, and keeps
 * `=`/`<>` three-valued. Consequences, derived rule by rule:
 *
 *   - De Morgan is NOT sound: with a blank and b FALSE, AND(NOT(a), NOT(b))
 *     is FALSE but NOT(OR(a, b)) is TRUE. Suggestion only.
 *   - Annihilators (AND(x, FALSE) → FALSE) would swallow an #Error! raised by
 *     x. Suggestion only — but truncating arguments AFTER a literal FALSE is
 *     sound, because short-circuiting makes them unreachable.
 *   - Collapsing AND(x, TRUE) → x or IF(x, TRUE, FALSE) → x is sound only when
 *     x provably yields a non-blank Boolean; otherwise a blank x that coerced
 *     to FALSE inside would resurface as blank.
 *
 * The rules below are policed by a property test comparing original vs
 * simplified through the real evaluator over randomized inputs including
 * blanks, both blank modes, and error-raising subexpressions.
 */

export interface SimplifyStep {
  /** Machine-readable rule id. */
  readonly rule: string;
  /** Human-readable rule name. */
  readonly title: string;
  /** The local rewrite, rendered (`sub → replacement`). */
  readonly detail: string;
  /** Whole formula before/after this step, formatted. */
  readonly before: string;
  readonly after: string;
}

/** A rewrite that is NOT blank-safe (or error-safe), demoted per DESIGN §8.2. */
export interface SimplifySuggestion {
  readonly rule: string;
  readonly message: string;
  readonly span: Span;
}

export interface SimplifyResult {
  readonly ast: Expr;
  /** `formatExpr(ast)` — what the Apply button writes into the editor. */
  readonly formatted: string;
  readonly steps: readonly SimplifyStep[];
  readonly suggestions: readonly SimplifySuggestion[];
  readonly changed: boolean;
}

export function simplify(root: Expr): SimplifyResult {
  const steps: SimplifyStep[] = [];
  let current = root;

  const deparened = cleanParens(root, null, "left");
  if (countParens(deparened) < countParens(root)) {
    steps.push({
      rule: "redundant-parens",
      title: t().simplifier.redundantParens.title,
      detail: oneLine(deparened),
      before: formatExpr(root),
      after: formatExpr(deparened),
    });
    current = deparened;
  }

  // Each rule strictly decreases node count, so this terminates; the cap is a
  // belt-and-braces guard against a future non-decreasing rule.
  for (let i = 0; i < 200; i++) {
    const rewritten = rewriteOnce(current);
    if (!rewritten) {
      break;
    }
    steps.push({
      rule: rewritten.rule,
      title: rewritten.title,
      detail: rewritten.detail,
      before: formatExpr(current),
      after: formatExpr(rewritten.node),
    });
    current = rewritten.node;
  }

  return {
    ast: current,
    formatted: formatExpr(current),
    steps,
    suggestions: collectSuggestions(current),
    changed: steps.length > 0,
  };
}

/** Parse-then-simplify. Returns null when the source has syntax errors. */
export function simplifySource(source: string): SimplifyResult | null {
  const { ast, diagnostics } = parse(source);
  if (
    ast.kind === "ErrorNode" ||
    diagnostics.some((d) => d.severity === "error")
  ) {
    return null;
  }
  return simplify(ast);
}

// --- shared helpers ------------------------------------------------------

function oneLine(node: Expr): string {
  return formatExpr(node, { maxWidth: Number.MAX_SAFE_INTEGER });
}

function stripParens(node: Expr): Expr {
  return node.kind === "Paren" ? stripParens(node.expr) : node;
}

/** Structural equality modulo explicit parentheses. */
function sameExpr(a: Expr, b: Expr): boolean {
  return astEqual(deepStrip(a), deepStrip(b));
}

function deepStrip(node: Expr): Expr {
  switch (node.kind) {
    case "Paren":
      return deepStrip(node.expr);
    case "FunctionCall":
      return { ...node, args: node.args.map(deepStrip) };
    case "BinaryOp":
      return {
        ...node,
        left: deepStrip(node.left),
        right: deepStrip(node.right),
      };
    case "UnaryOp":
      return { ...node, operand: deepStrip(node.operand) };
    default:
      return node;
  }
}

function isCall(node: Expr, name: string): node is FunctionCall {
  return node.kind === "FunctionCall" && node.callee.toUpperCase() === name;
}

function isBoolLit(node: Expr, value: boolean): boolean {
  const s = stripParens(node);
  return s.kind === "BooleanLit" && s.value === value;
}

/**
 * Whether a node provably evaluates to a non-blank Boolean (or an #Error!,
 * which every rewrite below propagates identically). AND/OR, the ordering
 * comparisons, and the blank-inspecting predicates always return a real
 * Boolean; `=`/`<>` and NOT can yield blank, and field types are unknown.
 */
function nonBlankBoolean(node: Expr): boolean {
  switch (node.kind) {
    case "BooleanLit":
      return true;
    case "Paren":
      return nonBlankBoolean(node.expr);
    case "BinaryOp":
      return (
        node.op === "<" ||
        node.op === "<=" ||
        node.op === ">" ||
        node.op === ">="
      );
    case "FunctionCall": {
      const name = node.callee.toUpperCase();
      if (NONBLANK_BOOL_FNS.has(name)) {
        return true;
      }
      if (name === "IF" && node.args.length === 3) {
        return nonBlankBoolean(node.args[1]!) && nonBlankBoolean(node.args[2]!);
      }
      return false;
    }
    default:
      return false;
  }
}

const NONBLANK_BOOL_FNS = new Set([
  "AND",
  "OR",
  "ISBLANK",
  "ISNULL",
  "ISNUMBER",
  "ISPICKVAL",
]);

/** Boolean-typed, possibly blank — what double negation may pass through. */
function booleanTyped(node: Expr): boolean {
  if (nonBlankBoolean(node)) {
    return true;
  }
  switch (node.kind) {
    case "NullLit":
      return true;
    case "Paren":
      return booleanTyped(node.expr);
    case "BinaryOp":
      return (
        node.op === "=" ||
        node.op === "<>" ||
        node.op === "==" ||
        node.op === "!="
      );
    case "FunctionCall": {
      const name = node.callee.toUpperCase();
      if (name === "NOT" && node.args.length === 1) {
        return true;
      }
      if (name === "IF" && node.args.length === 3) {
        return booleanTyped(node.args[1]!) && booleanTyped(node.args[2]!);
      }
      return false;
    }
    default:
      return false;
  }
}

// --- redundant parentheses ----------------------------------------------

function countParens(node: Expr): number {
  let n = node.kind === "Paren" ? 1 : 0;
  for (const c of childrenOf(node)) {
    n += countParens(c);
  }
  return n;
}

function childrenOf(node: Expr): readonly Expr[] {
  switch (node.kind) {
    case "FunctionCall":
      return node.args;
    case "BinaryOp":
      return [node.left, node.right];
    case "UnaryOp":
      return [node.operand];
    case "Paren":
      return [node.expr];
    default:
      return [];
  }
}

/**
 * Drop every Paren node the formatter would not re-insert: parens at the root,
 * around function arguments, and where operator precedence already binds the
 * way the parens do. Purely structural — the evaluator ignores Paren.
 */
function cleanParens(
  node: Expr,
  parent: Expr | null,
  side: "left" | "right",
): Expr {
  if (node.kind === "Paren") {
    const inner = cleanParens(node.expr, parent, side);
    const keep =
      parent !== null &&
      (parent.kind === "BinaryOp" || parent.kind === "UnaryOp") &&
      needsParens(inner, parent, side);
    return keep ? { ...node, expr: inner } : inner;
  }
  switch (node.kind) {
    case "FunctionCall":
      return {
        ...node,
        args: node.args.map((a) => cleanParens(a, node, "left")),
      };
    case "BinaryOp":
      return {
        ...node,
        left: cleanParens(node.left, node, "left"),
        right: cleanParens(node.right, node, "right"),
      };
    case "UnaryOp":
      return { ...node, operand: cleanParens(node.operand, node, "left") };
    default:
      return node;
  }
}

// --- rewrite engine ------------------------------------------------------

interface Rewrite {
  readonly node: Expr;
  readonly rule: string;
  readonly title: string;
  readonly detail: string;
}

/** Apply the first matching rule anywhere in the tree (self before children). */
function rewriteOnce(node: Expr): Rewrite | null {
  const local = applyRules(node);
  if (local) {
    return {
      ...local,
      detail: `${oneLine(node)}  →  ${oneLine(local.node)}`,
    };
  }
  const kids = childrenOf(node);
  for (let i = 0; i < kids.length; i++) {
    const r = rewriteOnce(kids[i]!);
    if (r) {
      return { ...r, node: replaceChild(node, i, r.node) };
    }
  }
  return null;
}

function replaceChild(parent: Expr, index: number, child: Expr): Expr {
  switch (parent.kind) {
    case "FunctionCall": {
      const args = [...parent.args];
      args[index] = child;
      return { ...parent, args };
    }
    case "BinaryOp":
      return index === 0
        ? { ...parent, left: child }
        : { ...parent, right: child };
    case "UnaryOp":
      return { ...parent, operand: child };
    case "Paren":
      return { ...parent, expr: child };
    default:
      return parent;
  }
}

type Rule = (node: Expr) => Omit<Rewrite, "detail"> | null;

const RULES: readonly Rule[] = [
  foldConstant,
  literalIfCondition,
  booleanShapedIf,
  doubleNegation,
  negatedEquality,
  flattenAndOr,
  dropIdentityArgs,
  truncateAfterAnnihilator,
  dropRedundantArgs,
];

function applyRules(node: Expr): Omit<Rewrite, "detail"> | null {
  for (const rule of RULES) {
    const r = rule(node);
    if (r) {
      return r;
    }
  }
  return null;
}

// --- rules ---------------------------------------------------------------

const LITERAL_KINDS = new Set([
  "NumberLit",
  "StringLit",
  "BooleanLit",
  "NullLit",
]);

/**
 * Fold a field-free, null-free subtree by running the real evaluator on it.
 * Skipped when evaluation errors (the #Error! must stay visible), refuses
 * (unsupported construct), yields blank, yields a type with no literal form, or when the
 * literal would print longer than the expression it replaces (folding 1/3 to
 * 32 decimal places is not a simplification).
 */
function foldConstant(node: Expr): Omit<Rewrite, "detail"> | null {
  if (LITERAL_KINDS.has(node.kind) || !isFoldable(node)) {
    return null;
  }
  let value;
  try {
    value = evaluateFormula(node, { fields: new Map(), blankMode: "blank" });
  } catch (e) {
    if (e instanceof UnsupportedError) {
      return null;
    }
    throw e;
  }
  if (isError(value) || value.blank) {
    return null;
  }
  const literal = toLiteral(value, node.span);
  if (!literal || oneLine(literal).length > oneLine(node).length) {
    return null;
  }
  return {
    node: literal,
    rule: "constant-fold",
    title: t().simplifier.constantFold.title,
  };
}

/** No fields (env-dependent) and no NULL literals (blank-mode-dependent). */
function isFoldable(node: Expr): boolean {
  if (
    node.kind === "FieldRef" ||
    node.kind === "NullLit" ||
    node.kind === "ErrorNode"
  ) {
    return false;
  }
  return childrenOf(node).every(isFoldable);
}

function toLiteral(value: SfValue, span: Span): Expr | null {
  if (value.type === "Boolean") {
    return { kind: "BooleanLit", value: value.data, span };
  }
  if (
    value.type === "Number" ||
    value.type === "Currency" ||
    value.type === "Percent"
  ) {
    const raw = value.data.toString();
    if (/^\d+(\.\d+)?$/.test(raw)) {
      return { kind: "NumberLit", raw, span };
    }
    const abs = raw.replace(/^-/, "");
    if (raw.startsWith("-") && /^\d+(\.\d+)?$/.test(abs)) {
      return {
        kind: "UnaryOp",
        op: "-",
        opSpan: span,
        operand: { kind: "NumberLit", raw: abs, span },
        span,
      };
    }
    return null; // exponent notation — no faithful literal form
  }
  if (value.type === "Text") {
    // Only strings the lexer round-trips verbatim; skip quotes/escapes.
    if (/^[^"\\\r\n]*$/.test(value.data)) {
      return {
        kind: "StringLit",
        value: value.data,
        raw: `"${value.data}"`,
        span,
      };
    }
  }
  return null;
}

/** IF with a literal condition: TRUE → then-branch; FALSE or NULL → else. */
function literalIfCondition(node: Expr): Omit<Rewrite, "detail"> | null {
  if (!isCall(node, "IF") || node.args.length !== 3) {
    return null;
  }
  const cond = stripParens(node.args[0]!);
  if (cond.kind === "BooleanLit") {
    return {
      node: node.args[cond.value ? 1 : 2]!,
      rule: "if-literal-condition",
      title: t().simplifier.ifLiteralCondition.takeBranch(cond.value),
    };
  }
  // A literal NULL condition coerces to FALSE in a boolean position.
  if (cond.kind === "NullLit") {
    return {
      node: node.args[2]!,
      rule: "if-literal-condition",
      title: t().simplifier.ifLiteralCondition.takeFalseBranchNullCondition,
    };
  }
  return null;
}

/**
 * IF(x, TRUE, FALSE) → x and IF(x, FALSE, TRUE) → NOT(x) — only when x
 * provably yields a non-blank Boolean; a blank x coerces to FALSE inside the
 * IF but would resurface as blank on its own.
 */
function booleanShapedIf(node: Expr): Omit<Rewrite, "detail"> | null {
  if (!isCall(node, "IF") || node.args.length !== 3) {
    return null;
  }
  const [cond, thenB, elseB] = node.args as [Expr, Expr, Expr];
  if (!nonBlankBoolean(cond)) {
    return null;
  }
  if (isBoolLit(thenB, true) && isBoolLit(elseB, false)) {
    return {
      node: cond,
      rule: "boolean-shaped-if",
      title: t().simplifier.booleanShapedIf.isX,
    };
  }
  if (isBoolLit(thenB, false) && isBoolLit(elseB, true)) {
    return {
      node: {
        kind: "FunctionCall",
        callee: "NOT",
        calleeSpan: node.span,
        args: [cond],
        span: node.span,
      },
      rule: "boolean-shaped-if",
      title: t().simplifier.booleanShapedIf.isNotX,
    };
  }
  return null;
}

/** NOT(NOT(x)) → x, when x is boolean-typed (blank passes through both NOTs). */
function doubleNegation(node: Expr): Omit<Rewrite, "detail"> | null {
  if (!isCall(node, "NOT") || node.args.length !== 1) {
    return null;
  }
  const inner = stripParens(node.args[0]!);
  if (!isCall(inner, "NOT") || inner.args.length !== 1) {
    return null;
  }
  const x = inner.args[0]!;
  if (!booleanTyped(x)) {
    return null;
  }
  return {
    node: x,
    rule: "double-negation",
    title: t().simplifier.doubleNegation.title,
  };
}

const NEGATED_EQUALITY: Partial<Record<BinaryOp["op"], BinaryOp["op"]>> = {
  "=": "<>",
  "==": "<>",
  "<>": "=",
  "!=": "=",
};

/**
 * NOT(a = b) → a <> b (and back). Sound in three-valued semantics: when the
 * equality is unknown (blank operand), both forms yield blank. The ordering
 * operators are NOT safe to flip this way — see collectSuggestions.
 */
function negatedEquality(node: Expr): Omit<Rewrite, "detail"> | null {
  if (!isCall(node, "NOT") || node.args.length !== 1) {
    return null;
  }
  const inner = stripParens(node.args[0]!);
  if (inner.kind !== "BinaryOp") {
    return null;
  }
  const flipped = NEGATED_EQUALITY[inner.op];
  if (!flipped) {
    return null;
  }
  return {
    node: { ...inner, op: flipped },
    rule: "negated-equality",
    title: t().simplifier.negatedEquality.title(inner.op, flipped),
  };
}

/** AND(AND(a, b), c) → AND(a, b, c); same for OR. Associativity holds even
 * with blank coercion and short-circuiting, because a nested AND/OR always
 * yields a real Boolean and evaluation order is unchanged. */
function flattenAndOr(node: Expr): Omit<Rewrite, "detail"> | null {
  for (const name of ["AND", "OR"] as const) {
    if (!isCall(node, name)) {
      continue;
    }
    const i = node.args.findIndex((a) => isCall(stripParens(a), name));
    if (i < 0) {
      return null;
    }
    const nested = stripParens(node.args[i]!) as FunctionCall;
    const args = [
      ...node.args.slice(0, i),
      ...nested.args,
      ...node.args.slice(i + 1),
    ];
    return {
      node: { ...node, args },
      rule: "flatten-logical",
      title: t().simplifier.flattenLogical.title(name),
    };
  }
  return null;
}

/**
 * Drop TRUE from AND / FALSE from OR. The literal never short-circuits or
 * changes coercion, so removal is invisible — but collapsing to a single
 * remaining argument requires it to be provably non-blank Boolean.
 */
function dropIdentityArgs(node: Expr): Omit<Rewrite, "detail"> | null {
  for (const [name, identity] of [
    ["AND", true],
    ["OR", false],
  ] as const) {
    if (!isCall(node, name)) {
      continue;
    }
    const kept = node.args.filter((a) => !isBoolLit(a, identity));
    if (kept.length === node.args.length || kept.length === 0) {
      return null;
    }
    if (kept.length === 1) {
      if (!nonBlankBoolean(kept[0]!)) {
        return null;
      }
      return {
        node: kept[0]!,
        rule: "identity-law",
        title: t().simplifier.identityLaw.title(identity, name),
      };
    }
    return {
      node: { ...node, args: kept },
      rule: "identity-law",
      title: t().simplifier.identityLaw.title(identity, name),
    };
  }
  return null;
}

/**
 * AND short-circuits at a literal FALSE (OR at TRUE), so later arguments are
 * unreachable — drop them. When the literal comes first the whole call is that
 * literal (nothing before it can raise an #Error!). The annihilator law itself
 * (AND(x, FALSE) → FALSE) is unsafe when x can error; see collectSuggestions.
 */
function truncateAfterAnnihilator(node: Expr): Omit<Rewrite, "detail"> | null {
  for (const [name, annihilator] of [
    ["AND", false],
    ["OR", true],
  ] as const) {
    if (!isCall(node, name)) {
      continue;
    }
    const i = node.args.findIndex((a) => isBoolLit(a, annihilator));
    if (i < 0) {
      return null;
    }
    if (i === 0) {
      return {
        node: {
          kind: "BooleanLit",
          value: annihilator,
          span: node.span,
        },
        rule: "short-circuit",
        title: t().simplifier.shortCircuit.constant(name, annihilator),
      };
    }
    if (i === node.args.length - 1) {
      return null;
    }
    return {
      node: { ...node, args: node.args.slice(0, i + 1) },
      rule: "short-circuit",
      title: t().simplifier.shortCircuit.truncated(annihilator),
    };
  }
  return null;
}

/**
 * Inside AND/OR, drop an argument that repeats an earlier one (idempotence)
 * or absorbs it (AND(x, …, OR(x, …)) — by the time the OR is reached, x is
 * known TRUE, so the OR is TRUE). Sound regardless of blanks: if the earlier
 * x was blank or FALSE, evaluation short-circuited before the dropped
 * argument; if it errored, the error already surfaced.
 */
function dropRedundantArgs(node: Expr): Omit<Rewrite, "detail"> | null {
  for (const [name, dual] of [
    ["AND", "OR"],
    ["OR", "AND"],
  ] as const) {
    if (!isCall(node, name)) {
      continue;
    }
    for (let j = 1; j < node.args.length; j++) {
      const arg = stripParens(node.args[j]!);
      const earlier = node.args.slice(0, j);
      const duplicate = earlier.some((e) => sameExpr(e, arg));
      const absorbed =
        isCall(arg, dual) &&
        arg.args.length > 0 &&
        earlier.some((e) => sameExpr(e, arg.args[0]!));
      if (!duplicate && !absorbed) {
        continue;
      }
      const args = node.args.filter((_, k) => k !== j);
      const rewrite = {
        rule: duplicate ? "idempotence" : "absorption",
        title: duplicate
          ? t().simplifier.idempotence.title
          : t().simplifier.absorption.title,
      };
      if (args.length === 1) {
        if (!nonBlankBoolean(args[0]!)) {
          continue;
        }
        return { node: args[0]!, ...rewrite };
      }
      return { node: { ...node, args }, ...rewrite };
    }
    return null;
  }
  return null;
}

// --- suggestions (rewrites that are not blank/error-safe) ----------------

function collectSuggestions(root: Expr): readonly SimplifySuggestion[] {
  const out: SimplifySuggestion[] = [];
  // An IF that is part of an already-suggested chain must not re-suggest its
  // own tail as a shorter CASE.
  const consumedChainLinks = new Set<Expr>();
  visit(root, (node) => {
    suggestDeMorgan(node, out);
    suggestAnnihilator(node, out);
    suggestBooleanIf(node, out);
    suggestOrderingNegation(node, out);
    suggestCaseChain(node, out, consumedChainLinks);
  });
  return out;
}

function visit(node: Expr, f: (n: Expr) => void): void {
  f(node);
  for (const c of childrenOf(node)) {
    visit(c, f);
  }
}

/** De Morgan direction that would shorten: all-negated AND/OR operands. */
function suggestDeMorgan(node: Expr, out: SimplifySuggestion[]): void {
  for (const [name, dual] of [
    ["AND", "OR"],
    ["OR", "AND"],
  ] as const) {
    if (!isCall(node, name) || node.args.length < 2) {
      continue;
    }
    const inners = node.args.map((a) => {
      const s = stripParens(a);
      return isCall(s, "NOT") && s.args.length === 1 ? s.args[0]! : null;
    });
    if (!inners.every((x) => x !== null)) {
      continue;
    }
    const rewritten: Expr = {
      kind: "FunctionCall",
      callee: "NOT",
      calleeSpan: node.span,
      args: [
        {
          kind: "FunctionCall",
          callee: dual,
          calleeSpan: node.span,
          args: inners as Expr[],
          span: node.span,
        },
      ],
      span: node.span,
    };
    out.push({
      rule: "de-morgan",
      span: node.span,
      message: t().simplifier.deMorgan.suggestion(oneLine(rewritten)),
    });
  }
}

/** AND ending in FALSE / OR ending in TRUE is constant — unless an earlier
 * argument raises #Error!, which the constant would swallow. */
function suggestAnnihilator(node: Expr, out: SimplifySuggestion[]): void {
  for (const [name, annihilator] of [
    ["AND", false],
    ["OR", true],
  ] as const) {
    if (!isCall(node, name) || node.args.length < 2) {
      continue;
    }
    if (isBoolLit(node.args[node.args.length - 1]!, annihilator)) {
      out.push({
        rule: "annihilator",
        span: node.span,
        message: t().simplifier.annihilator.suggestion(name, annihilator),
      });
    }
  }
}

/** IF(x, TRUE, FALSE) → x when x is not provably non-blank. */
function suggestBooleanIf(node: Expr, out: SimplifySuggestion[]): void {
  if (!isCall(node, "IF") || node.args.length !== 3) {
    return;
  }
  const [cond, thenB, elseB] = node.args as [Expr, Expr, Expr];
  if (
    isBoolLit(thenB, true) &&
    isBoolLit(elseB, false) &&
    !nonBlankBoolean(cond)
  ) {
    out.push({
      rule: "boolean-shaped-if",
      span: node.span,
      message: t().simplifier.booleanShapedIf.suggestion(oneLine(cond)),
    });
  }
}

const ORDERING_FLIP: Partial<Record<BinaryOp["op"], BinaryOp["op"]>> = {
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

/** NOT(a < b) is NOT a >= b when an operand is blank: both orderings are
 * FALSE against blank, so the NOT form is TRUE and the flip is FALSE. */
function suggestOrderingNegation(node: Expr, out: SimplifySuggestion[]): void {
  if (!isCall(node, "NOT") || node.args.length !== 1) {
    return;
  }
  const inner = stripParens(node.args[0]!);
  if (inner.kind !== "BinaryOp") {
    return;
  }
  const flipped = ORDERING_FLIP[inner.op];
  if (!flipped) {
    return;
  }
  out.push({
    rule: "ordering-negation",
    span: node.span,
    message: t().simplifier.orderingNegation.suggestion(
      oneLine({ ...inner, op: flipped }),
    ),
  });
}

/** An IF/else chain testing one subject against literals reads as a CASE. */
function suggestCaseChain(
  node: Expr,
  out: SimplifySuggestion[],
  consumed: Set<Expr>,
): void {
  if (consumed.has(node)) {
    return;
  }
  const chain = matchCaseChain(node);
  if (!chain || chain.pairs.length < 2) {
    return;
  }
  // Mark the else-spine's nested IFs so they don't suggest their sub-chains.
  for (let link = node; isCall(link, "IF") && link.args.length === 3;) {
    consumed.add(link);
    const next = stripParens(link.args[2]!);
    if (!isCall(next, "IF")) {
      break;
    }
    link = next;
  }
  const caseCall: Expr = {
    kind: "FunctionCall",
    callee: "CASE",
    calleeSpan: node.span,
    args: [
      chain.subject,
      ...chain.pairs.flatMap((p) => [p.value, p.result]),
      chain.fallback,
    ],
    span: node.span,
  };
  out.push({
    rule: "case-chain",
    span: node.span,
    message: t().simplifier.caseChain.suggestion(oneLine(caseCall)),
  });
}

interface CaseChain {
  readonly subject: Expr;
  readonly pairs: readonly { value: Expr; result: Expr }[];
  readonly fallback: Expr;
}

function matchCaseChain(node: Expr): CaseChain | null {
  if (!isCall(node, "IF") || node.args.length !== 3) {
    return null;
  }
  const cond = stripParens(node.args[0]!);
  if (cond.kind !== "BinaryOp" || (cond.op !== "=" && cond.op !== "==")) {
    return null;
  }
  const subject = cond.left;
  const value = stripParens(cond.right);
  if (!LITERAL_KINDS.has(value.kind) || value.kind === "NullLit") {
    return null;
  }
  const pair = { value, result: node.args[1]! };
  const rest = stripParens(node.args[2]!);
  const nested = matchCaseChain(rest);
  if (nested && sameExpr(nested.subject, subject)) {
    return {
      subject,
      pairs: [pair, ...nested.pairs],
      fallback: nested.fallback,
    };
  }
  return { subject, pairs: [pair], fallback: node.args[2]! };
}
