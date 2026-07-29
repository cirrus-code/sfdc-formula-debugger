import type { SfType } from "../registry/index.ts";

/**
 * A golden corpus row: `(formula, context, inputs, blankMode, expected)` — the
 * durable, language-agnostic conformance asset (DESIGN §10). Expected values are
 * kept as the oracle's raw rendered strings; the comparator (conformance.ts)
 * normalizes them per type so the corpus stays engine-agnostic.
 */
export interface CorpusRow {
  /** Provenance for the trust order (CONFORMANCE.md). */
  readonly source: string;
  readonly name: string;
  readonly formula: string;
  /** The oracle's declared result data type (e.g. "Double", "Text", "DateOnly"). */
  readonly dataType: string;
  readonly fields: readonly CorpusField[];
  readonly blankMode: "zero" | "blank";
  /**
   * Raw expected rendering from the oracle. Special forms: `"Error: <class>"`
   * means a runtime error (our `#Error!`); `"null"` means a blank result.
   */
  readonly expected: string;
}

export interface CorpusField {
  /** Field name as it appears in the formula (e.g. "amount__c"). */
  readonly name: string;
  readonly type: SfType;
  /** Raw input value, or null when the field is left blank. */
  readonly value: string | null;
}

/** Map a Salesforce test dataType to our value-domain type. */
export function sfDataTypeToType(dataType: string): SfType {
  switch (dataType.toLowerCase()) {
    case "double":
    case "number":
    case "integer":
    case "long":
      return "Number";
    case "currency":
      return "Currency";
    case "percent":
      return "Percent";
    case "boolean":
      return "Boolean";
    // A Long Text Area is a Text value, blank included: the org reads
    // ISNULL(blank text area) as false and NULLVALUE over it as no
    // substitution, the same as Text (corpus:testISNULLWithTextArea#1,
    // corpus:testNVLWithTextArea#1, probed against a real Long Text Area).
    case "text":
    case "string":
    case "textarea":
      return "Text";
    case "id":
      return "Id";
    case "picklist":
      return "Picklist";
    case "multipicklist":
      return "Multipicklist";
    case "dateonly":
    case "date":
      return "Date";
    case "datetime":
      return "Datetime";
    case "time":
      return "Time";
    default:
      return "Unknown";
  }
}
