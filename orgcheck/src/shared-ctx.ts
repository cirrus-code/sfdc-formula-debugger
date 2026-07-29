// Shared types for the per-context availability pass (generate-ctx →
// collect-ctx → emit-ctx). Erasable-TS only, like shared.ts.
//
// This pass asks a different question than the value probes (generate.ts):
// not "what does this formula evaluate to" but "does this context's compiler
// accept this construct at all". Each probe is one metadata component whose
// deploy accept/reject is the verdict, so the plan is a list of deployable
// component fragments rather than formula fields + records.

/** Availability-matrix container ids — every registry context. */
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
  | "runtime_rule" // active gated VR for the DML-triggered runtime pass
  | "flow_value" // Active flow whose interview output is a value probe
  | "wfu_runtime" // active gated workflow rule + field update (value channel)
  | "approval_runtime"; // active gated approval process (submit-for-approval channel)

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
  readonly id: string; // "support" | "runtime" | "flow_values" | "<container>:canary" | "<container>:matrix"
  readonly container?: CtxContainerId;
  readonly phase:
    | "support"
    | "canary"
    | "matrix"
    | "runtime"
    | "flow_values"
    | "wfu_runtime"
    | "approval_runtime";
  readonly componentIds: readonly string[];
}

/** A gated active workflow rule + field update whose written value is the
 * observation (the runtime channel for the workflow_field_update context). */
export interface CtxFieldUpdateProbe {
  readonly id: string;
  readonly target: "Text" | "Number";
  readonly formula: string;
  readonly question: string;
}

/** A flow whose formula VALUE is read back by running the interview. */
export interface CtxFlowValueProbe {
  readonly id: string;
  readonly formula: string;
  readonly returns: string;
  readonly question: string;
}

/** An ACTIVE approval process whose criteria formula is evaluated by the org at
 * submit-for-approval time. `approval_entry` probes carry the formula as
 * process entry criteria (trivial step); `approval_step` probes invert — the
 * entry criteria is the bare gate and the formula guards step 1. */
export interface CtxApprovalProbe {
  readonly id: string;
  readonly context: "approval_entry" | "approval_step";
  readonly object: string;
  /** Gate value inserted into Gate__c so at most one active process on the
   * object matches; error probes are gateless and own their object outright,
   * since a criteria that throws would otherwise be evaluated for every
   * submission on a shared object. */
  readonly gate?: string;
  readonly formula: string;
  readonly question: string;
  readonly interpret: Readonly<Record<string, string>>;
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
  readonly flowValueProbes: readonly CtxFlowValueProbe[];
  readonly fieldUpdateProbes: readonly CtxFieldUpdateProbe[];
  readonly approvalProbes: readonly CtxApprovalProbe[];
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

export interface CtxFlowValueResult {
  readonly id: string;
  readonly outcome: "VALUE" | "ERROR" | "NOT_RUN";
  readonly value?: string;
}

export interface CtxFieldUpdateResult {
  readonly id: string;
  /** WROTE = record saved, target readable (possibly null); BLOCKED = the
   * insert itself failed; NOT_RUN = rule/update never deployed. */
  readonly outcome: "WROTE" | "BLOCKED" | "NOT_RUN";
  readonly value?: string | null;
  readonly message?: string;
}

export interface CtxApprovalResult {
  readonly id: string;
  readonly context: "approval_entry" | "approval_step";
  /** SUBMITTED = the process was entered; NO_PROCESS = the org found no
   * applicable process (a false entry criteria reads this way); REFUSED = the
   * submit failed for some other reason; EXCEPTION = the submit call threw;
   * INSERT_FAILED = the probe record never saved, so nothing was observed. */
  readonly outcome:
    | "SUBMITTED"
    | "NO_PROCESS"
    | "REFUSED"
    | "EXCEPTION"
    | "INSERT_FAILED"
    | "NOT_RUN";
  /** Approval.ProcessResult.getInstanceStatus(): Pending when a step produced a
   * work item, Approved when step criteria were skipped into final approval. */
  readonly instanceStatus?: string;
  /** New work items from the submit; -1 when the call never got that far. */
  readonly workitems?: number;
  readonly message?: string;
  /** ProcessInstance readback keyed by process developer name, as independent
   * corroboration of the in-transaction ProcessResult. */
  readonly instanceStatusSoql?: string;
  readonly workitemsSoql?: number;
}

/** One deploy of the approval components. The create and update passes are
 * recorded separately: some containers validate formulas only on one path. */
export interface CtxApprovalDeployPass {
  readonly pass: "create" | "update" | "update_flip";
  readonly accepted: readonly string[];
  readonly rejected: Readonly<Record<string, string>>;
}

export interface CtxApprovalChannel {
  /** ok-canary deployed AND a bogus-function canary rejected on at least one
   * pass — otherwise nothing this channel reports is a verdict. */
  readonly verifiable: boolean;
  readonly detail: string;
  readonly passes: readonly CtxApprovalDeployPass[];
}

export interface CtxResults {
  readonly collectedAt: string;
  readonly org: Readonly<Record<string, unknown>>;
  readonly containerStatus: readonly CtxContainerStatus[];
  readonly probes: readonly CtxProbeResult[];
  readonly untestable: readonly CtxUntestable[];
  readonly runtime: readonly CtxRuntimeResult[];
  readonly flowValues: readonly CtxFlowValueResult[];
  readonly fieldUpdates: readonly CtxFieldUpdateResult[];
  readonly approvals: readonly CtxApprovalResult[];
  readonly approvalChannel?: CtxApprovalChannel;
}
