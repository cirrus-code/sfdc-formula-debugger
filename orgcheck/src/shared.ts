// Shared types for the org-verification harness. Erasable-TS only: these
// scripts run under `node --experimental-strip-types` (no parameter
// properties, no enums).

/** Formula-field return types we deploy. */
export type ProbeReturn =
  | "Number"
  | "Text"
  | "Checkbox"
  | "Date"
  | "Datetime"
  | "Time"
  | "Currency"
  | "Percent";

/** Input-field types on the probe object. */
export type FieldType =
  | "Number"
  | "Text"
  | "TextArea"
  | "Date"
  | "Datetime"
  | "Boolean"
  | "Time"
  | "Picklist"
  | "Multipicklist"
  | "Currency"
  | "Percent";

export interface FieldSpec {
  readonly type: FieldType;
  /** Raw value; null = leave blank. Dates `Y:M:D[:h:m:s]`, times `h:m:s`. */
  readonly value: string | null;
}

/** A hand-written probe (syntax.json / semantics.json `probes`). */
export interface Probe {
  readonly id: string;
  /** Which VERIFICATION.md / CONFORMANCE.md question this settles. */
  readonly question: string;
  readonly formula: string;
  readonly returns: ProbeReturn;
  /** Default "blank"; "both" deploys a field per mode. */
  readonly blankMode?: "zero" | "blank" | "both";
  /** True: save rejection is the expected outcome. "maybe": rejection is one
   * of the possible verdicts (e.g. contested operators). */
  readonly expectSaveError?: boolean | "maybe";
  /** True: the observed value is env-specific (session ids, org ids) — the
   * save/evaluate outcome is the verdict, but the value must not be emitted
   * into the committed corpus. */
  readonly envSpecific?: boolean;
  readonly fields?: Readonly<Record<string, FieldSpec>>;
  /** Map from observed result → what that result means. */
  readonly interpret?: Readonly<Record<string, string>>;
  readonly note?: string;
}

/** Re-verify a whole oracle corpus test (all its rows) against the org. */
export interface CorpusRef {
  readonly name: string;
  readonly question: string;
  /** Corpus typing fixes, e.g. customtextarea1__c → TextArea. */
  readonly fieldTypeOverrides?: Readonly<Record<string, FieldType>>;
  /** "maybe": the function may not exist in the product at all (OSS-only). */
  readonly expectSaveError?: "maybe";
}

export interface SyntaxManifest {
  readonly probes: readonly Probe[];
}
export interface SemanticsManifest {
  readonly corpusRefs: readonly CorpusRef[];
  readonly probes: readonly Probe[];
}

// ---- generated plan (generate.ts → plan.json → collect.ts) ----

export interface PlanInputField {
  readonly apiName: string;
  readonly type: FieldType;
  readonly scale?: number;
  readonly picklistValues?: readonly string[];
}

export interface PlanRow {
  readonly recordKey: string;
  readonly fields: readonly {
    name: string;
    type: FieldType;
    value: string | null;
  }[];
  /** The JVM oracle's expected rendering, when re-verifying a corpus test. */
  readonly oracleExpected?: string;
}

export interface PlanFormulaField {
  readonly apiName: string;
  readonly probeId: string;
  readonly question: string;
  readonly blankMode: "zero" | "blank";
  readonly formula: string;
  readonly returns: ProbeReturn;
  /** Set on TEXT() twins: apiName of the primary field they mirror. */
  readonly twinOf?: string;
  readonly expectSaveError?: boolean | "maybe";
  readonly envSpecific?: boolean;
  readonly interpret?: Readonly<Record<string, string>>;
  /** Org field name (lowercased) → original corpus field name. Corpus-ref
   * inputs are namespaced per test so each org field needs only one type and
   * scale; the emitter reverse-maps so published rows keep original names. */
  readonly fieldAliases?: Readonly<Record<string, string>>;
  readonly rows: readonly PlanRow[];
}

export interface Plan {
  readonly objectApiName: string;
  readonly inputFields: readonly PlanInputField[];
  readonly formulaFields: readonly PlanFormulaField[];
  /** recordKey → fieldApiName(lowercase) → spec. */
  readonly records: Readonly<Record<string, Record<string, FieldSpec>>>;
}

export const OBJECT_API_NAME = "FxProbe1__c";
export const KEY_FIELD = "ProbeKey__c";

/** Formula return type → the oracle-style dataType used in corpus rows. */
export function returnToDataType(r: ProbeReturn): string {
  switch (r) {
    case "Number":
      return "Double";
    case "Text":
      return "Text";
    case "Checkbox":
      return "Boolean";
    case "Date":
      return "DateOnly";
    case "Datetime":
      return "DateTime";
    case "Time":
      return "TimeOnly";
    case "Currency":
      return "Currency";
    case "Percent":
      return "Percent";
  }
}
