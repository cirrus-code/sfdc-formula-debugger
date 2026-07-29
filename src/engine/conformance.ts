import { parse, type Expr } from "../syntax/index.ts";
import { getFunction } from "../registry/index.ts";
import type { CorpusField, CorpusRow } from "./corpus.ts";
import { evaluateFormula } from "./evaluator.ts";
import {
  blank,
  bool,
  dateValue,
  datetimeValue,
  Decimal,
  isError,
  text,
  UnsupportedError,
  asBool,
  asDecimal,
  asText,
  type SfValue,
} from "./value.ts";
import { concatString, epochOfDate } from "./builtins.ts";

/**
 * Conformance comparison of our evaluator against an oracle corpus row
 * (CONFORMANCE.md). Honest by construction: only value types we can faithfully
 * round-trip now (Number-family, Boolean, Text, and error-as-a-category) are
 * compared; everything else is `quarantine`d, and constructs outside our
 * simulation subset are `unsupported`. The conformance number is
 * `pass / (pass + fail)`, never inflated by quarantined or unsupported rows.
 */
export type RowStatus = "pass" | "fail" | "quarantine" | "unsupported";

export interface RowOutcome {
  readonly status: RowStatus;
  readonly got?: string;
}

export interface RunOptions {
  /**
   * The org readback channel (SOQL, orgcheck/) renders blank, whitespace-only
   * text (trailing whitespace is trimmed at save), and `#Error!` all as null,
   * so an org row whose expected value is "null" accepts any of the three.
   * Oracle corpora leave this off — there "null" means precisely blank.
   */
  readonly nullIsChannelAmbiguous?: boolean;
}

/** Thrown internally when a row can't be set up within our current support. */
class Unsupported extends Error {}

export function runRow(row: CorpusRow, opts: RunOptions = {}): RowOutcome {
  let ast: Expr;
  try {
    ast = parse(row.formula).ast;
    assertSupportedFunctions(ast);
    const fields = new Map<string, SfValue>(
      row.fields.map((f) => [f.name, buildField(f)]),
    );
    const raw = evaluateFormula(ast, {
      fields,
      blankMode: row.blankMode,
      now: { epochMillis: 0 },
    });
    // The corpus rows read back stored formula-field values, and the product
    // truncates Text formula OUTPUT at 1,300 characters (org-verified,
    // semantics:csize_base) — a storage boundary, not expression semantics.
    const result =
      !isError(raw) && isText(raw) && !raw.blank && asText(raw).length > 1300
        ? text(asText(raw).slice(0, 1300))
        : raw;
    // Org-tier numeric expectations come from the TEXT() twin channel
    // (orgcheck reads TEXT(expr) for exact rendering), which sees the
    // pre-materialization value at the product's full digit budget. When the
    // materialized numeric comparison can't decide, compare what our own
    // TEXT(expr) renders — the same question the org answered.
    const twinRender = (): string | null => {
      const twin = evaluateFormula(parse(`TEXT(${row.formula})`).ast, {
        fields,
        blankMode: row.blankMode,
        now: { epochMillis: 0 },
      });
      return !isError(twin) && isText(twin) ? asText(twin) : null;
    };
    return compare(result, row, opts, twinRender);
  } catch (e) {
    if (e instanceof Unsupported || e instanceof UnsupportedError) {
      return { status: "unsupported" };
    }
    throw e;
  }
}

/** Any non-simulatable or unregistered function makes the whole row unsupported. */
function assertSupportedFunctions(node: Expr): void {
  switch (node.kind) {
    case "FunctionCall": {
      const spec = getFunction(node.callee);
      if (!spec || !spec.simulatable) {
        throw new Unsupported(node.callee);
      }
      node.args.forEach(assertSupportedFunctions);
      return;
    }
    case "BinaryOp":
      assertSupportedFunctions(node.left);
      assertSupportedFunctions(node.right);
      return;
    case "UnaryOp":
      assertSupportedFunctions(node.operand);
      return;
    case "Paren":
      assertSupportedFunctions(node.expr);
      return;
    default:
      return;
  }
}

function buildField(f: CorpusField): SfValue {
  // An empty input cell means the field is left blank.
  if (f.value === null || f.value === "") {
    return blank(f.type);
  }
  switch (f.type) {
    case "Number":
    case "Currency":
    case "Percent":
      try {
        // Salesforce uses a Percent field's value divided by 100 in arithmetic
        // (a 99% field reads as 0.99). Verified against the oracle.
        const d = new Decimal(f.value);
        return {
          type: f.type,
          blank: false,
          data: f.type === "Percent" ? d.div(100) : d,
        };
      } catch {
        throw new Unsupported(`unparsable number ${f.value}`);
      }
    case "Boolean":
      return bool(/^true$/i.test(f.value));
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return text(f.value);
    case "Date":
    case "Datetime":
      return buildTemporal(f.type, f.value);
    default:
      throw new Unsupported(`unbuildable field type ${f.type}`);
  }
}

/**
 * Corpus temporal encoding: `Y:M:D[:h:m:s[:GMT|:PST]]` (the corpus contains
 * the same instant in both PST and GMT spellings, pinning PST at −8h), plus a
 * literal "No data" sentinel for blank. A Date field fed a full timestamp
 * truncates to its GMT date. Unknown shapes stay a loud refusal.
 */
function buildTemporal(type: "Date" | "Datetime", value: string): SfValue {
  if (value === "No data") {
    return blank(type);
  }
  const m = value.match(
    /^(\d{4}):(\d{1,2}):(\d{1,2})(?::(\d{1,2}):(\d{1,2}):(\d{1,2})(?::(GMT|PST))?)?$/,
  );
  if (!m) {
    throw new Unsupported(`unbuildable ${type} encoding ${value}`);
  }
  const [y, mo, d, hh, mi, ss] = m.slice(1, 7).map((x) => Number(x ?? 0));
  const offsetHours = m[7] === "PST" ? 8 : 0;
  // epochOfDate, not Date.UTC — the latter remaps years 0-99 to the 1900s.
  const epoch =
    epochOfDate({ year: y, month: mo, day: d }) +
    (((hh + offsetHours) * 60 + mi) * 60 + ss) * 1000;
  if (type === "Datetime") {
    return datetimeValue(epoch);
  }
  const g = new Date(epoch);
  return dateValue({
    year: g.getUTCFullYear(),
    month: g.getUTCMonth() + 1,
    day: g.getUTCDate(),
  });
}

function compare(
  result: ReturnType<typeof evaluateFormula>,
  row: CorpusRow,
  opts: RunOptions,
  twinRender?: () => string | null,
): RowOutcome {
  const expected = row.expected;

  if (expected.startsWith("Error:")) {
    return { status: isError(result) ? "pass" : "fail", got: describe(result) };
  }
  if (expected === "null") {
    const isBlank = !isError(result) && result.blank;
    const ok = opts.nullIsChannelAmbiguous
      ? isBlank ||
        isError(result) ||
        (!isError(result) && isText(result) && asText(result).trim() === "")
      : isBlank;
    return { status: ok ? "pass" : "fail", got: describe(result) };
  }
  if (isError(result)) {
    return { status: "fail", got: `#Error(${result.reason})` };
  }
  if (result.blank) {
    return { status: "fail", got: "blank" };
  }

  switch (row.dataType.toLowerCase()) {
    case "double":
    case "currency":
    case "number": {
      const numeric = numberCompare(result, expected, false);
      if (numeric.status === "fail" && twinRender?.() === expected) {
        return { status: "pass" };
      }
      return numeric;
    }
    case "percent": {
      // A Percent-typed result compares as the internal value × 100; the
      // org's TEXT twin channel renders the raw internal value instead.
      const pct = numberCompare(result, expected, true);
      if (pct.status === "fail" && twinRender?.() === expected) {
        return { status: "pass" };
      }
      return pct;
    }
    case "boolean":
      return {
        status: matchBool(result, expected) ? "pass" : "fail",
        got: describe(result),
      };
    case "text":
    case "string":
    case "id":
      return {
        status: isText(result) && asText(result) === expected ? "pass" : "fail",
        got: describe(result),
      };
    case "dateonly":
    case "datetime":
    case "timeonly": {
      // The oracle renders temporals Java-style ("Tue Nov 15 17:00:00 GMT
      // 2005"); those rows are incomparable (quarantine). Rows rendered in
      // our own shapes — ISO dates, GMT "…Z" datetimes, LocalTime-style
      // times (exactly the org-tier encodings) — compare.
      if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} /.test(expected)) {
        return { status: "quarantine" };
      }
      const rendered =
        result.type === "Date" ||
        result.type === "Datetime" ||
        result.type === "Time"
          ? concatString(result)
          : null;
      return {
        status: rendered === expected ? "pass" : "fail",
        got: rendered ?? describe(result),
      };
    }
    default:
      return { status: "quarantine" };
  }
}

function numberCompare(
  result: SfValue,
  expected: string,
  isPercent: boolean,
): RowOutcome {
  if (!isNumber(result)) {
    return { status: "fail", got: describe(result) };
  }
  let expectedDec: Decimal;
  try {
    expectedDec = new Decimal(expected);
  } catch {
    return { status: "quarantine" };
  }
  const actual = isPercent ? asDecimal(result).times(100) : asDecimal(result);
  return {
    status: actual.equals(expectedDec) ? "pass" : "fail",
    got: actual.toString(),
  };
}

function matchBool(result: SfValue, expected: string): boolean {
  return (
    result.type === "Boolean" && asBool(result) === /^true$/i.test(expected)
  );
}

function isNumber(v: SfValue): boolean {
  return v.type === "Number" || v.type === "Currency" || v.type === "Percent";
}

function isText(v: SfValue): boolean {
  return (
    v.type === "Text" ||
    v.type === "Id" ||
    v.type === "Picklist" ||
    v.type === "Multipicklist"
  );
}

function describe(result: ReturnType<typeof evaluateFormula>): string {
  if (isError(result)) {
    return `#Error(${result.reason})`;
  }
  if (result.blank) {
    return "blank";
  }
  if (isNumber(result)) {
    return asDecimal(result).toString();
  }
  if (isText(result)) {
    return asText(result);
  }
  if (result.type === "Boolean") {
    return String(asBool(result));
  }
  return result.type;
}
