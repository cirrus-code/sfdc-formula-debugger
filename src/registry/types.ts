/**
 * Registry type definitions — the shape of the semantic single source of truth
 * (DESIGN §4). The tables themselves live in functions.ts and contexts.ts;
 * this file fixes the types every layer above depends on.
 */

/**
 * The Salesforce value domain (DESIGN §6). `Unknown` is the inference/error
 * escape hatch and unifies with anything. Blankness is a value-level state, not
 * a member of this union.
 */
export type SfType =
  | "Text"
  | "Number"
  | "Currency"
  | "Percent"
  | "Boolean"
  | "Date"
  | "Datetime"
  | "Time"
  | "Picklist"
  | "Multipicklist"
  | "Id"
  | "Unknown";

/** Identifier for a formula context (e.g. "formula_field", "validation_rule"). */
export type ContextId = string;

export interface ParamSpec {
  readonly name: string;
  readonly type: SfType;
  /**
   * Additional accepted families beyond `type`, for params that genuinely
   * take unrelated types (DATEVALUE: text or a datetime). The checker accepts
   * an argument assignable to any listed type.
   */
  readonly altTypes?: readonly SfType[];
  /**
   * Types the product rejects at save even when `type` is `Unknown` —
   * ISBLANK/ISNULL take anything EXCEPT a Boolean ("Incorrect argument type",
   * org-verified). The checker reports these as save-blocking.
   */
  readonly rejectTypes?: readonly SfType[];
  /** A variadic tail param absorbs all remaining arguments. */
  readonly variadic?: boolean;
  readonly optional?: boolean;
}

/**
 * How a function's return type is determined: a fixed type, or a rule such as
 * "same as argument N" (e.g. `IF`, `MAX`).
 */
export type TypeRule =
  { kind: "fixed"; type: SfType } | { kind: "sameAsArg"; index: number };

export interface LintNote {
  readonly id: string;
  readonly message: string;
}

export interface Arity {
  readonly min: number;
  /** Number.POSITIVE_INFINITY when the function is variadic. */
  readonly max: number;
}

export interface FunctionSpec {
  /** Canonical uppercase name. */
  readonly name: string;
  readonly params: readonly ParamSpec[];
  readonly returnType: TypeRule;
  /** Contexts where Salesforce allows the function, or "all". */
  readonly contexts: readonly ContextId[] | "all";
  /** false ⇒ hard "unsupported" during simulation — refuse, never guess. */
  readonly simulatable: boolean;
  readonly docsUrl: string;
  /** Short hover text. */
  readonly summary: string;
  readonly lintNotes?: readonly LintNote[];
  /**
   * Per-context argument-count override: contexts listed here require the
   * given range instead of the arity derived from `params`. Contexts absent
   * from this map fall back to the derived arity. Only populate from an
   * org-verified fact (e.g. TRUNC's single-argument form is
   * formula-field-only) — never a guess.
   */
  readonly contextArity?: Partial<Readonly<Record<ContextId, Arity>>>;
}

export interface GlobalSpec {
  readonly name: string; // e.g. "$User"
  /** Whether this global's fields can be user-filled in simulation. */
  readonly simulatable: boolean;
}

/**
 * How a simulated runtime error (the evaluator's `#Error!` outcome) actually
 * manifests once Salesforce runs the formula for real in this context:
 * - "error_value": the field displays the literal `#Error!` value.
 * - "blocks_save": the containing record save is rejected outright.
 * - "blocks_submit": the record saves, but submitting it for approval fails.
 * - "null_result": no fault occurs — the formula resolves to blank and
 *   execution continues.
 * Leave unset where this is unverified; the UI must show nothing beyond the
 * generic `#Error!` outcome in that case.
 */
export type RuntimeErrorBehavior =
  "error_value" | "blocks_save" | "blocks_submit" | "null_result";

export interface FormulaContext {
  readonly id: ContextId;
  readonly label: string;
  /** Verification status: Tier 1 = verified availability, Tier 2 = best-effort. */
  readonly tier: 1 | 2;
  readonly globals: readonly GlobalSpec[];
  readonly requiredReturnType?: SfType;
  readonly blankModeToggle: boolean;
  readonly charLimit?: number;
  readonly notes?: string;
  readonly runtimeErrorBehavior?: RuntimeErrorBehavior;
  /** English detail sentence for runtimeErrorBehavior; translated via the
   * contextRuntimeErrorNotes sparse overlay (i18n/README.md). Required
   * whenever runtimeErrorBehavior is set. */
  readonly runtimeErrorNote?: string;
}
