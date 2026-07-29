import {
  parse,
  span,
  childrenOf,
  visitExpr,
  type BinaryOp,
  type Diagnostic,
  type Expr,
  type FieldRef,
  type FunctionCall,
  type StringLit,
} from "../syntax/index.ts";
import { analyze } from "../analysis/index.ts";
import {
  localizedContextLabel,
  localizedFunctionLintNote,
  t,
} from "../i18n/index.ts";
import { getContext, getFunction } from "../registry/index.ts";

/**
 * Linter (DESIGN §8.4): registry- and AST-driven style/robustness hints, emitted
 * as ordinary `Diagnostic`s so they surface in the same Problems panel and
 * editor squiggles as syntax and type findings.
 *
 * Every rule here is a heuristic over an AST whose field types are Unknown, so
 * messages hedge ("looks like", "if X is a picklist") and severity never
 * exceeds `warning` — unlike the evaluator, which must be exact or refuse,
 * the linter is allowed to be helpfully unsure.
 */

/** IF chains nested deeper than this suggest CASE() or restructuring. */
const MAX_IF_DEPTH = 3;

/**
 * Salesforce record-ID shape: 15 (case-sensitive) or 18 (case-safe) base-62
 * characters. Requiring at least one digit and one letter filters out ordinary
 * words and numbers of coincidental length.
 */
const ID_SHAPE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

const EQUALITY_OPS: ReadonlySet<BinaryOp["op"]> = new Set([
  "=",
  "<>",
  "==",
  "!=",
]);

/**
 * Full diagnostic pipeline — parse (syntax + recovery), analyze (types, arity,
 * availability, return type), lint (style/robustness) — in source order. The
 * single entry point for the editor's lint source and the UI Problems panel.
 * Lives here rather than in analysis/ because the dependency arrow points
 * features → analysis, never back.
 */
export function diagnose(
  source: string,
  contextId: string,
): readonly Diagnostic[] {
  const { ast, diagnostics } = parse(source);
  return [
    ...diagnostics,
    ...analyze(ast, contextId),
    ...lint(ast, source, contextId),
  ].sort((a, b) => a.span.start - b.span.start);
}

/** Run only the lint rules over an already-parsed formula. */
export function lint(
  root: Expr,
  source: string,
  contextId: string,
): readonly Diagnostic[] {
  const out: Diagnostic[] = [];

  visitExpr(root, (node) => {
    switch (node.kind) {
      case "StringLit":
        checkHardcodedId(node, out);
        return;
      case "BinaryOp":
        checkTextPicklistComparison(node, out);
        return;
      case "FunctionCall":
        checkLintNotes(node, out);
        return;
      default:
        return;
    }
  });

  checkIfNesting(root, out);
  checkCharLimit(source, contextId, out);

  return out.sort((a, b) => a.span.start - b.span.start);
}

function unwrapParen(node: Expr): Expr {
  return node.kind === "Paren" ? unwrapParen(node.expr) : node;
}

// --- rules ---------------------------------------------------------------

function checkHardcodedId(node: StringLit, out: Diagnostic[]): void {
  if (!ID_SHAPE.test(node.value)) {
    return;
  }
  out.push({
    code: "hardcoded-id",
    severity: "warning",
    span: node.span,
    message: t().linter.hardcodedId(node.value),
  });
}

/**
 * Report the outermost IF whose nesting depth exceeds the threshold, then stop
 * descending — one finding per chain, not one per level.
 */
function checkIfNesting(node: Expr, out: Diagnostic[]): void {
  if (isIf(node)) {
    const depth = ifDepth(node);
    if (depth > MAX_IF_DEPTH) {
      out.push({
        code: "deep-if-nesting",
        severity: "info",
        span: node.calleeSpan,
        message: t().linter.deepIfNesting(depth),
        docsUrl: getFunction("CASE")?.docsUrl,
      });
      return;
    }
  }
  for (const child of childrenOf(node)) {
    checkIfNesting(child, out);
  }
}

function isIf(node: Expr): node is FunctionCall {
  return node.kind === "FunctionCall" && node.callee.toUpperCase() === "IF";
}

/** Maximum count of IF calls along any root-to-leaf path of the subtree. */
function ifDepth(node: Expr): number {
  const inner = Math.max(0, ...childrenOf(node).map(ifDepth));
  return isIf(node) ? inner + 1 : inner;
}

function checkTextPicklistComparison(node: BinaryOp, out: Diagnostic[]): void {
  if (!EQUALITY_OPS.has(node.op)) {
    return;
  }
  const left = unwrapParen(node.left);
  const right = unwrapParen(node.right);

  let field: FieldRef | null = null;
  let literal: StringLit | null = null;
  if (right.kind === "StringLit") {
    field = textOfField(left);
    literal = right;
  } else if (left.kind === "StringLit") {
    field = textOfField(right);
    literal = left;
  }
  if (!field || !literal) {
    return;
  }

  const path = field.path.join(".");
  out.push({
    code: "prefer-ispickval",
    severity: "info",
    span: node.span,
    message: t().linter.preferIspickval(path, literal.raw),
    docsUrl: getFunction("ISPICKVAL")?.docsUrl,
  });
}

/** Match `TEXT(field)` and return the field, else null. */
function textOfField(node: Expr): FieldRef | null {
  if (
    node.kind !== "FunctionCall" ||
    node.callee.toUpperCase() !== "TEXT" ||
    node.args.length !== 1
  ) {
    return null;
  }
  const arg = unwrapParen(node.args[0]!);
  return arg.kind === "FieldRef" && !arg.isGlobal ? arg : null;
}

/** Surface the registry's per-function `lintNotes` (discouraged constructs). */
function checkLintNotes(node: FunctionCall, out: Diagnostic[]): void {
  const spec = getFunction(node.callee);
  if (!spec?.lintNotes) {
    return;
  }
  for (const note of spec.lintNotes) {
    out.push({
      code: "discouraged-function",
      severity: "info",
      span: node.calleeSpan,
      message: localizedFunctionLintNote(note.id, note.message),
      docsUrl: spec.docsUrl,
    });
  }
}

function checkCharLimit(
  source: string,
  contextId: string,
  out: Diagnostic[],
): void {
  const context = getContext(contextId);
  if (!context?.charLimit || source.length <= context.charLimit) {
    return;
  }
  out.push({
    code: "char-limit",
    severity: "warning",
    // Highlight the overflowing tail rather than the whole document.
    span: span(context.charLimit, source.length),
    message: t().linter.charLimit(
      source.length,
      localizedContextLabel(context.id, context.label),
      context.charLimit,
    ),
  });
}
