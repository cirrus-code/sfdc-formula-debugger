import { assertNever } from "../../syntax/index.ts";
import {
  asBool,
  asDecimal,
  asText,
  blank,
  bool,
  dateValue,
  datetimeValue,
  Decimal,
  isError,
  text,
  timeValue,
  type EvalResult,
  type SfValue,
} from "../../engine/index.ts";
import { concatString, epochOfDate } from "../../engine/builtins.ts";
import type { SfType } from "../../registry/index.ts";
import { t } from "../../i18n/index.ts";

/** Types offered in the simulation form's per-field type picker. */
export const FIELD_TYPES: readonly SfType[] = [
  "Text",
  "Number",
  "Currency",
  "Percent",
  "Boolean",
  "Date",
  "Datetime",
  "Time",
  "Picklist",
  "Id",
];

/**
 * Build a value from a form field's (type, raw input, blank) state. An invalid
 * number or date falls back to blank rather than guessing a value.
 */
export function buildFieldValue(
  type: SfType,
  raw: string,
  isBlank: boolean,
): SfValue {
  if (isBlank) {
    return blank(type);
  }
  switch (type) {
    case "Number":
    case "Currency":
    case "Percent":
      try {
        // A Percent field's arithmetic value is the entered value / 100 (99% → 0.99).
        const d = new Decimal(raw === "" ? 0 : raw);
        return {
          type,
          blank: false,
          data: type === "Percent" ? d.div(100) : d,
        };
      } catch {
        return blank(type);
      }
    case "Boolean":
      return bool(raw === "true");
    case "Date": {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
      return m
        ? dateValue({
            year: Number(m[1]),
            month: Number(m[2]),
            day: Number(m[3]),
          })
        : blank("Date");
    }
    case "Time": {
      // Same "HH:MM(:SS)?(.SSS)?" shape the engine's TIMEVALUE parses.
      const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/.exec(
        raw.trim(),
      );
      if (!m) {
        return blank("Time");
      }
      const [hh, mi, ss] = m.slice(1, 4).map((x) => Number(x ?? 0));
      const millis = Number((m[4] ?? "0").padEnd(3, "0"));
      if (hh > 23 || mi > 59 || ss > 59) {
        return blank("Time");
      }
      return timeValue(((hh * 60 + mi) * 60 + ss) * 1000 + millis);
    }
    case "Datetime": {
      // Same "YYYY-MM-DD HH:MM(:SS)?" shape the engine's DATETIMEVALUE parses.
      const m =
        /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(
          raw.trim(),
        );
      if (!m) {
        return blank("Datetime");
      }
      const [y, mo, d, hh, mi, ss] = m.slice(1).map((x) => Number(x ?? 0));
      if (
        mo < 1 ||
        mo > 12 ||
        d < 1 ||
        d > 31 ||
        hh > 23 ||
        mi > 59 ||
        ss > 59
      ) {
        return blank("Datetime");
      }
      return datetimeValue(
        epochOfDate({ year: y, month: mo, day: d }) +
          ((hh * 60 + mi) * 60 + ss) * 1000,
      );
    }
    default:
      return text(raw);
  }
}

/** Human-readable rendering of an evaluation result for the result panel. */
export function renderResult(result: EvalResult): string {
  if (isError(result)) {
    return "#Error!";
  }
  if (result.blank) {
    return t().ui.simulate.blankResult;
  }
  switch (result.type) {
    case "Number":
    case "Currency":
    case "Percent":
      // toFixed() (no argument) renders the full stored value in plain
      // notation — toString() would flip to scientific notation outside
      // ~1e-7..1e21, a format Salesforce never shows.
      return asDecimal(result).toFixed();
    case "Boolean":
      return asBool(result) ? "TRUE" : "FALSE";
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return asText(result);
    case "Date":
      return `${String(result.data.year).padStart(4, "0")}-${String(result.data.month).padStart(2, "0")}-${String(result.data.day).padStart(2, "0")}`;
    case "Datetime":
    case "Time":
      return concatString(result);
    case "Unknown":
      // Only ever constructed blank (see engine/value.ts's blank()); the
      // blank check above already handles it in practice.
      return t().ui.simulate.blankResult;
    default:
      return assertNever(result);
  }
}

/**
 * The evaluation outcome's display text and typed discriminant, computed
 * together so callers never re-derive "is this an error" by string-comparing
 * rendered text — a formula can legitimately evaluate to the text "#Error!".
 */
export type ResultOutcome =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

export function classifyResult(result: EvalResult): ResultOutcome {
  return isError(result)
    ? { kind: "error", text: renderResult(result) }
    : { kind: "value", text: renderResult(result) };
}
