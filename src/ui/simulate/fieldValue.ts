import {
  asBool,
  asDecimal,
  asText,
  blank,
  bool,
  dateValue,
  Decimal,
  isError,
  text,
  type EvalResult,
  type SfValue,
} from "../../engine/index.ts";
import type { SfType } from "../../registry/index.ts";

/** Types offered in the simulation form's per-field type picker. */
export const FIELD_TYPES: readonly SfType[] = [
  "Text",
  "Number",
  "Currency",
  "Percent",
  "Boolean",
  "Date",
  "Picklist",
  "Id",
];

/**
 * Build a value from a form field's (type, raw input, blank) state. An invalid
 * number or date falls back to blank rather than guessing a value.
 */
export function buildFieldValue(type: SfType, raw: string, isBlank: boolean): SfValue {
  if (isBlank) {return blank(type);}
  switch (type) {
    case "Number":
    case "Currency":
    case "Percent":
      try {
        // A Percent field's arithmetic value is the entered value / 100 (99% → 0.99).
        const d = new Decimal(raw === "" ? 0 : raw);
        return { type, blank: false, data: type === "Percent" ? d.div(100) : d };
      } catch {
        return blank(type);
      }
    case "Boolean":
      return bool(raw === "true");
    case "Date": {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
      return m ? dateValue({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) : blank("Date");
    }
    default:
      return text(raw);
  }
}

/** Human-readable rendering of an evaluation result for the result panel. */
export function renderResult(result: EvalResult): string {
  if (isError(result)) {return "#Error!";}
  if (result.blank) {return "(blank)";}
  switch (result.type) {
    case "Number":
    case "Currency":
    case "Percent":
      return asDecimal(result).toString();
    case "Boolean":
      return asBool(result) ? "TRUE" : "FALSE";
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return asText(result);
    case "Date":
      return `${result.data.year}-${String(result.data.month).padStart(2, "0")}-${String(result.data.day).padStart(2, "0")}`;
    default:
      return result.type;
  }
}
