import { parse, type Expr } from "../syntax/index.ts";
import { getFunction } from "../registry/index.ts";
import type { CorpusField, CorpusRow } from "./corpus.ts";
import { evaluateFormula } from "./evaluator.ts";
import {
  blank,
  bool,
  Decimal,
  isError,
  num,
  text,
  UnsupportedError,
  asBool,
  asDecimal,
  asText,
  type SfValue,
} from "./value.ts";

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

/** Thrown internally when a row can't be set up within our current support. */
class Unsupported extends Error {}

export function runRow(row: CorpusRow): RowOutcome {
  let ast: Expr;
  try {
    ast = parse(row.formula).ast;
    assertSupportedFunctions(ast);
    const fields = new Map<string, SfValue>(row.fields.map((f) => [f.name, buildField(f)]));
    const result = evaluateFormula(ast, {
      fields,
      blankMode: row.blankMode,
      now: { epochMillis: 0 },
    });
    return compare(result, row);
  } catch (e) {
    if (e instanceof Unsupported || e instanceof UnsupportedError) {return { status: "unsupported" };}
    throw e;
  }
}

/** Any non-simulatable or unregistered function makes the whole row unsupported. */
function assertSupportedFunctions(node: Expr): void {
  switch (node.kind) {
    case "FunctionCall": {
      const spec = getFunction(node.callee);
      if (!spec || !spec.simulatable) {throw new Unsupported(node.callee);}
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
  if (f.value === null || f.value === "") {return blank(f.type);}
  switch (f.type) {
    case "Number":
    case "Currency":
    case "Percent":
      try {
        return num(new Decimal(f.value));
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
    default:
      // Date/Datetime/Time input encodings vary; we can't build them reliably yet.
      throw new Unsupported(`unbuildable field type ${f.type}`);
  }
}

function compare(result: ReturnType<typeof evaluateFormula>, row: CorpusRow): RowOutcome {
  const expected = row.expected;

  if (expected.startsWith("Error:")) {
    return { status: isError(result) ? "pass" : "fail", got: describe(result) };
  }
  if (expected === "null") {
    const isBlank = !isError(result) && result.blank;
    return { status: isBlank ? "pass" : "fail", got: describe(result) };
  }
  if (isError(result)) {return { status: "fail", got: `#Error(${result.reason})` }; }
  if (result.blank) {return { status: "fail", got: "blank" };}

  switch (row.dataType.toLowerCase()) {
    case "double":
    case "currency":
    case "percent":
    case "number":
      return numberCompare(result, expected);
    case "boolean":
      return { status: matchBool(result, expected) ? "pass" : "fail", got: describe(result) };
    case "text":
    case "string":
    case "id":
      return { status: isText(result) && asText(result) === expected ? "pass" : "fail", got: describe(result) };
    default:
      return { status: "quarantine" };
  }
}

function numberCompare(result: SfValue, expected: string): RowOutcome {
  if (!isNumber(result)) {return { status: "fail", got: describe(result) };}
  let expectedDec: Decimal;
  try {
    expectedDec = new Decimal(expected);
  } catch {
    return { status: "quarantine" };
  }
  return { status: asDecimal(result).equals(expectedDec) ? "pass" : "fail", got: asDecimal(result).toString() };
}

function matchBool(result: SfValue, expected: string): boolean {
  return result.type === "Boolean" && asBool(result) === /^true$/i.test(expected);
}

function isNumber(v: SfValue): boolean {
  return v.type === "Number" || v.type === "Currency" || v.type === "Percent";
}

function isText(v: SfValue): boolean {
  return v.type === "Text" || v.type === "Id" || v.type === "Picklist" || v.type === "Multipicklist";
}

function describe(result: ReturnType<typeof evaluateFormula>): string {
  if (isError(result)) {return `#Error(${result.reason})`;}
  if (result.blank) {return "blank";}
  if (isNumber(result)) {return asDecimal(result).toString();}
  if (isText(result)) {return asText(result);}
  if (result.type === "Boolean") {return String(asBool(result));}
  return result.type;
}
