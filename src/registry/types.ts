/**
 * Registry type definitions — the shape of the semantic single source of truth
 * (DESIGN §4). The tables themselves are populated in Phase 2; this file fixes
 * the types every layer above depends on.
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
  /** A variadic tail param absorbs all remaining arguments. */
  readonly variadic?: boolean;
  readonly optional?: boolean;
}

/**
 * How a function's return type is determined: a fixed type, or a rule such as
 * "same as argument N" (e.g. `IF`, `MAX`).
 */
export type TypeRule = { kind: "fixed"; type: SfType } | { kind: "sameAsArg"; index: number };

export interface LintNote {
  readonly id: string;
  readonly message: string;
}

export interface FunctionSpec {
  /** Canonical uppercase name. */
  readonly name: string;
  readonly params: readonly ParamSpec[];
  readonly returnType: TypeRule;
  /** Contexts where Salesforce allows the function, or "all". */
  readonly contexts: readonly ContextId[] | "all";
  /** false ⇒ hard "unsupported" during simulation (CLAUDE.md rule 1). */
  readonly simulatable: boolean;
  readonly docsUrl: string;
  /** Short hover text. */
  readonly summary: string;
  readonly lintNotes?: readonly LintNote[];
}

export interface GlobalSpec {
  readonly name: string; // e.g. "$User"
  /** Whether this global's fields can be user-filled in simulation. */
  readonly simulatable: boolean;
}

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
}
