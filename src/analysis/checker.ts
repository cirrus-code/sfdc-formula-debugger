import {
  assertNever,
  type BinaryOp,
  type Diagnostic,
  type DiagnosticCode,
  type Expr,
  type FunctionCall,
  type Severity,
  type Span,
} from "../syntax/index.ts";
import { localizedContextLabel, t } from "../i18n/index.ts";
import {
  functionArity,
  getContext,
  getFunction,
  type FunctionSpec,
  type SfType,
} from "../registry/index.ts";
import { isAssignable, isComparable, isDatelike, isNumeric } from "./types.ts";

/**
 * Type checker + context validator (DESIGN §6). Walks the AST against the
 * registry, inferring each node's type and emitting diagnostics for arity,
 * argument/operator type agreement, function availability, and the context's
 * required return type.
 *
 * Structural mistakes (unknown function, wrong arity) are errors. Type findings
 * are warnings: inference is heuristic — field types are Unknown until the user
 * supplies them — so a mismatch is a strong hint, not a proven fault. Values
 * involving Unknown never fire (Unknown unifies with everything).
 */
export function analyze(root: Expr, contextId: string): readonly Diagnostic[] {
  const checker = new Checker(contextId);
  const rootType = checker.check(root);

  const context = getContext(contextId);
  if (
    context?.requiredReturnType &&
    !isAssignable(rootType, context.requiredReturnType)
  ) {
    checker.report(
      "return-type-mismatch",
      "warning",
      root.span,
      t().checker.returnTypeMismatch(
        localizedContextLabel(context.id, context.label),
        context.requiredReturnType,
        rootType,
      ),
    );
  }

  return checker.diagnostics.sort((a, b) => a.span.start - b.span.start);
}

class Checker {
  readonly diagnostics: Diagnostic[] = [];
  private readonly tier2: boolean;

  constructor(private readonly contextId: string) {
    this.tier2 = getContext(contextId)?.tier === 2;
  }

  report(
    code: DiagnosticCode,
    severity: Severity,
    span: Span,
    message: string,
  ): void {
    this.diagnostics.push({ code, severity, span, message });
  }

  /** Infer a node's type while collecting diagnostics along the way. */
  check(node: Expr): SfType {
    switch (node.kind) {
      case "NumberLit":
        return "Number";
      case "StringLit":
        return "Text";
      case "BooleanLit":
        return "Boolean";
      case "NullLit":
      case "ErrorNode":
        return "Unknown";
      case "FieldRef":
        // Field types exist only in the simulator (user selection); the static
        // checker sees fields as Unknown, which suppresses type diagnostics
        // involving them.
        return "Unknown";
      case "Paren":
        return this.check(node.expr);
      case "UnaryOp": {
        const operand = this.check(node.operand);
        if (operand !== "Unknown" && !isNumeric(operand)) {
          this.report(
            "operator-type-mismatch",
            "warning",
            node.operand.span,
            t().checker.unaryOperatorTypeMismatch(node.op, operand),
          );
        }
        return "Number";
      }
      case "BinaryOp":
        return this.checkBinary(node);
      case "FunctionCall":
        return this.checkCall(node);
      default:
        return assertNever(node);
    }
  }

  private checkBinary(node: BinaryOp): SfType {
    const left = this.check(node.left);
    const right = this.check(node.right);

    switch (node.op) {
      case "*":
      case "/":
      case "^":
        this.expectNumeric(left, node.left.span, node.op);
        this.expectNumeric(right, node.right.span, node.op);
        return "Number";
      case "+":
      case "-":
        return this.checkAdditive(node, left, right);
      case "&":
        return "Text";
      case "<":
      case "<=":
      case ">":
      case ">=":
        if (!isComparable(left, right)) {
          this.report(
            "operator-type-mismatch",
            "warning",
            node.opSpan,
            t().checker.comparisonTypeMismatch(left, right, node.op),
          );
        }
        return "Boolean";
      case "=":
      case "<>":
        return "Boolean";
      case "==":
      case "!=":
        this.report(
          "nonstandard-operator",
          "warning",
          node.opSpan,
          t().checker.nonstandardOperator(
            node.op,
            node.op === "==" ? "=" : "<>",
          ),
        );
        return "Boolean";
      case "&&":
      case "||":
        this.report(
          "nonstandard-operator",
          "warning",
          node.opSpan,
          t().checker.nonstandardOperator(
            node.op,
            node.op === "&&" ? "AND()" : "OR()",
          ),
        );
        this.expectBoolean(left, node.left.span, node.op);
        this.expectBoolean(right, node.right.span, node.op);
        return "Boolean";
      default:
        return assertNever(node.op);
    }
  }

  /** `+`/`-` are numeric, plus Salesforce date arithmetic (Date ± Number, Date − Date). */
  private checkAdditive(node: BinaryOp, left: SfType, right: SfType): SfType {
    if (isDatelike(left)) {
      if (node.op === "-" && isDatelike(right)) {
        return "Number";
      }
      if (isNumeric(right) || right === "Unknown") {
        return left;
      }
    }
    this.expectNumeric(left, node.left.span, node.op);
    this.expectNumeric(right, node.right.span, node.op);
    return "Number";
  }

  private expectNumeric(type: SfType, span: Span, op: string): void {
    if (type !== "Unknown" && !isNumeric(type)) {
      this.report(
        "operator-type-mismatch",
        "warning",
        span,
        t().checker.operatorTypeMismatch(op, type),
      );
    }
  }

  private expectBoolean(type: SfType, span: Span, op: string): void {
    if (type !== "Unknown" && type !== "Boolean") {
      this.report(
        "operator-type-mismatch",
        "warning",
        span,
        t().checker.logicalOperatorTypeMismatch(op, type),
      );
    }
  }

  private checkCall(node: FunctionCall): SfType {
    const spec = getFunction(node.callee);
    if (!spec) {
      this.report(
        "unknown-function",
        "error",
        node.calleeSpan,
        t().checker.unknownFunction(node.callee),
      );
      for (const arg of node.args) {
        this.check(arg);
      }
      return "Unknown";
    }

    this.checkArity(node, spec);
    const argTypes = node.args.map((arg) => this.check(arg));
    this.checkArgTypes(node, spec, argTypes);
    this.checkAvailability(node, spec);

    if (spec.returnType.kind === "fixed") {
      return spec.returnType.type;
    }
    return argTypes[spec.returnType.index] ?? "Unknown";
  }

  private checkArity(node: FunctionCall, spec: FunctionSpec): void {
    // Tier 2 contexts aren't compile-checked at deploy, so a per-context
    // arity override can't be org-verified there either — fall back to the
    // base arity, the same best-effort treatment checkAvailability gives them.
    const { min, max } = this.tier2
      ? functionArity(spec)
      : functionArity(spec, this.contextId);
    const n = node.args.length;
    if (n < min || n > max) {
      this.report(
        "wrong-arity",
        "error",
        node.span,
        t().checker.wrongArity(
          spec.name,
          t().checker.arity(min, max === Number.POSITIVE_INFINITY ? null : max),
          n,
        ),
      );
    }
  }

  private checkArgTypes(
    node: FunctionCall,
    spec: FunctionSpec,
    argTypes: readonly SfType[],
  ): void {
    node.args.forEach((arg, i) => {
      const param = paramAt(spec, i);
      if (!param) {
        return;
      }
      const actual = argTypes[i]!;
      // A rejected type blocks the save in the product even when the param is
      // otherwise Unknown-typed (ISBLANK/ISNULL vs Boolean, org-verified).
      if (param.rejectTypes?.includes(actual)) {
        this.report(
          "argument-type-rejected",
          "error",
          arg.span,
          t().checker.argumentTypeRejected(spec.name, param.name, actual),
        );
        return;
      }
      const accepted = [param.type, ...(param.altTypes ?? [])];
      if (!accepted.some((t) => isAssignable(actual, t))) {
        this.report(
          "argument-type-mismatch",
          "warning",
          arg.span,
          t().checker.argumentTypeMismatch(
            spec.name,
            param.name,
            param.type,
            actual,
          ),
        );
      }
    });
  }

  private checkAvailability(node: FunctionCall, spec: FunctionSpec): void {
    if (spec.contexts === "all" || this.tier2) {
      return;
    }
    if (!spec.contexts.includes(this.contextId)) {
      const englishLabel = getContext(this.contextId)?.label ?? this.contextId;
      const label = localizedContextLabel(this.contextId, englishLabel);
      this.report(
        "function-not-available",
        "warning",
        node.calleeSpan,
        t().checker.functionNotAvailable(spec.name, label),
      );
    }
  }
}

/** The param governing argument `i`, following a trailing variadic param. */
function paramAt(
  spec: FunctionSpec,
  i: number,
): FunctionSpec["params"][number] | undefined {
  if (i < spec.params.length) {
    return spec.params[i];
  }
  const last = spec.params[spec.params.length - 1];
  return last?.variadic ? last : undefined;
}
