// Shared types for the wave-2 per-context pass (generate-ctx → collect-ctx →
// emit-ctx). Erasable-TS only, like shared.ts.
//
// Wave 2 asks a different question than wave 1: not "what does this formula
// evaluate to" but "does this context's compiler accept this construct at
// all". Each probe is one metadata component whose deploy accept/reject is the
// verdict, so the plan is a list of deployable component fragments rather than
// formula fields + records.

/** Wave-2 context ids — every registry context (formula_field joined the
 * matrix once the registry outgrew wave 1's hand-written probes). */
export type CtxContainerId =
  | "formula_field"
  | "validation_rule"
  | "workflow_rule"
  | "workflow_field_update"
  | "default_value"
  | "flow_formula"
  | "quick_action"
  | "custom_button_link"
  | "email_template"
  | "approval_entry"
  | "approval_step";

export type CtxComponentKind =
  | "support" // objects, input/target fields, custom setting/label/permission/CMT
  | "canary_ok" // trivially valid formula — must deploy, else container unusable
  | "canary_bogus" // BOGUSFN — must be REJECTED, else container validates nothing
  | "return_type" // wrong-typed formula; rejection message reveals the requirement
  | "function" // one registry function's availability probe
  | "global" // one $Global's availability probe
  | "runtime_rule"; // active gated VR for the DML-triggered runtime pass

/** One deployable metadata component (or a child fragment of a shared file). */
export interface CtxComponent {
  readonly id: string;
  readonly kind: CtxComponentKind;
  readonly container?: CtxContainerId;
  /** Function or global name this probe settles (kind function/global). */
  readonly name?: string;
  /** The probe formula exactly as deployed (after placeholder resolution). */
  readonly formula?: string;
  /** Helper constructs embedded besides the probed one (e.g. literal DATE()
   * args, an IF() wrapper). A rejection may be theirs, not the probe's;
   * emit-ctx cross-checks before treating the row as conclusive. */
  readonly taint?: readonly string[];
  /** package.xml type (CustomField, ValidationRule, Flow, …). */
  readonly mdType: string;
  /** package.xml member. */
  readonly fullName: string;
  /** Package-relative file this component lives in. */
  readonly file: string;
  /** Standalone file content (single-component files: flows, quick actions…). */
  readonly xml?: string;
  /** Fragment composed into a shared file (object children, workflow children,
   * labels); the shared file's shell lives in CtxPlan.shells. */
  readonly childXml?: string;
  /** Companion files deployed alongside (e.g. an email template's body file
   * next to its -meta.xml). */
  readonly extraFiles?: Readonly<Record<string, string>>;
}

/** A probe that could not be expressed in some container (e.g. PRIORVALUE
 * needs a field reference but default-value formulas cannot reference fields).
 * Recorded so "untestable" is reported honestly rather than silently absent. */
export interface CtxUntestable {
  readonly container: CtxContainerId;
  readonly kind: "function" | "global";
  readonly name: string;
  readonly reason: string;
}

/** Ordered deploy unit. Canary batches gate their container's matrix batch. */
export interface CtxBatch {
  readonly id: string; // "support" | "runtime" | "<container>:canary" | "<container>:matrix"
  readonly container?: CtxContainerId;
  readonly phase: "support" | "canary" | "matrix" | "runtime";
  readonly componentIds: readonly string[];
}

export interface CtxRuntimeProbe {
  readonly id: string;
  readonly object: string;
  /** Gate value inserted into Gate__c; error probes are gateless (sole record). */
  readonly gate?: string;
  readonly condition: string;
  readonly question: string;
  readonly interpret: Readonly<Record<string, string>>;
}

export interface CtxPlan {
  readonly components: readonly CtxComponent[];
  /** file → shell with a %CHILDREN% placeholder, for shared-file composition. */
  readonly shells: Readonly<Record<string, string>>;
  readonly batches: readonly CtxBatch[];
  readonly untestable: readonly CtxUntestable[];
  readonly runtimeProbes: readonly CtxRuntimeProbe[];
  /** Objects the runtime pass inserts into (permission-set + readback scope):
   * object api name → editable input field api names. */
  readonly runtimeObjects: Readonly<Record<string, readonly string[]>>;
}

/** Raw metadata-format deploys are schema-validated, and the CustomObject /
 * Workflow sequences are (fullName-first, then) alphabetical by element name —
 * package composition sorts child fragments the same way, so fragments can be
 * authored independently. */
export function childSortKey(childXml: string): string {
  const m = childXml.match(/<\s*([A-Za-z]+)/);
  return m ? m[1] : "";
}

// ---- collect-ctx output ----

export interface CtxProbeResult {
  readonly id: string;
  readonly kind: CtxComponentKind;
  readonly container?: CtxContainerId;
  readonly name?: string;
  readonly formula?: string;
  readonly taint?: readonly string[];
  readonly mdType: string;
  readonly fullName: string;
  readonly outcome: "accepted" | "rejected" | "skipped";
  readonly problem?: string;
  /** Set on skipped components: why the batch never deployed them. */
  readonly skipReason?: string;
}

export interface CtxContainerStatus {
  readonly container: CtxContainerId;
  /** ok-canary deployed AND bogus-canary rejected — acceptances are meaningful. */
  readonly verifiable: boolean;
  readonly detail: string;
}

export interface CtxRuntimeResult {
  readonly id: string;
  readonly outcome: "SAVED" | "FIRED" | "ERR" | "NOT_RUN";
  readonly message?: string;
}

export interface CtxResults {
  readonly collectedAt: string;
  readonly org: Readonly<Record<string, unknown>>;
  readonly containerStatus: readonly CtxContainerStatus[];
  readonly probes: readonly CtxProbeResult[];
  readonly untestable: readonly CtxUntestable[];
  readonly runtime: readonly CtxRuntimeResult[];
}
