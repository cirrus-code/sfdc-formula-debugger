import type {
  ContextId,
  FunctionSpec,
  ParamSpec,
  SfType,
  TypeRule,
} from "./types.ts";

/**
 * Function metadata table (DESIGN §4). Entries are typed data literals; a
 * self-consistency test validates them. `evalImpl` is intentionally absent —
 * evaluation lands in Phase 3; these entries drive type checking, availability
 * diagnostics, autocomplete, and hover.
 *
 * `contexts` restrictions and per-function availability are NOT yet org-verified
 * (see VERIFICATION.md); availability is surfaced as a soft warning only.
 */

// Salesforce's function reference is a single doc; per-function deep links are
// not stable, so we point at the canonical A–Z reference rather than fabricate.
const DOCS =
  "https://help.salesforce.com/s/articleView?id=sf.customize_functions.htm&type=5";

const fixed = (type: SfType): TypeRule => ({ kind: "fixed", type });
const sameAsArg = (index: number): TypeRule => ({ kind: "sameAsArg", index });

const req = (name: string, type: SfType): ParamSpec => ({ name, type });
const opt = (name: string, type: SfType): ParamSpec => ({
  name,
  type,
  optional: true,
});
const rest = (name: string, type: SfType): ParamSpec => ({
  name,
  type,
  variadic: true,
});

// Contexts where org-state / change-tracking functions are allowed. Restricted
// (not "all") so using them in a formula field produces an availability finding.
const CHANGE_CONTEXTS: readonly ContextId[] = [
  "validation_rule",
  "workflow_rule",
  "workflow_field_update",
  "approval_entry",
  "approval_step",
];

// Transcendental math: real Salesforce functions, but NOT simulatable — they
// compute as non-correctly-rounded doubles (Java StrictMath) whose last ULP a
// client cannot reproduce, so per rule 1 they refuse to simulate rather than
// return a subtly-wrong value. They still parse, highlight, lint, and hover.
const TRANSCENDENTAL: readonly FunctionSpec[] = (
  [
    ["LN", "Natural logarithm (base e) of a number."],
    ["LOG", "Base-10 logarithm of a number."],
    ["EXP", "e raised to the power of a number."],
    ["SIN", "Sine of an angle in radians."],
    ["COS", "Cosine of an angle in radians."],
    ["TAN", "Tangent of an angle in radians."],
    ["ASIN", "Arcsine of a number, in radians."],
    ["ACOS", "Arccosine of a number, in radians."],
    ["ATAN", "Arctangent of a number, in radians."],
  ] as const
).map(([name, summary]) => ({
  name,
  params: [req("number", "Number")],
  returnType: fixed("Number"),
  contexts: "all" as const,
  simulatable: false,
  docsUrl: DOCS,
  summary,
}));

export const FUNCTIONS: readonly FunctionSpec[] = [
  ...TRANSCENDENTAL,
  {
    name: "ATAN2",
    params: [req("y", "Number"), req("x", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: false,
    docsUrl: DOCS,
    summary: "Angle in radians between the positive x-axis and the point (x, y).",
  },
  // --- Logical ------------------------------------------------------------
  {
    name: "IF",
    params: [
      req("logical_test", "Boolean"),
      req("value_if_true", "Unknown"),
      req("value_if_false", "Unknown"),
    ],
    returnType: sameAsArg(1),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Returns one value if a condition is true and another if it is false.",
  },
  {
    name: "AND",
    params: [rest("logical", "Boolean")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if all arguments are true; otherwise FALSE.",
  },
  {
    name: "OR",
    params: [rest("logical", "Boolean")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if any argument is true; otherwise FALSE.",
  },
  {
    name: "NOT",
    params: [req("logical", "Boolean")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Reverses a boolean value.",
  },
  {
    name: "CASE",
    params: [req("expression", "Unknown"), rest("when_then_else", "Unknown")],
    returnType: fixed("Unknown"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Compares an expression to a series of values, returning the matching result or an else value.",
  },
  {
    name: "ISBLANK",
    params: [req("value", "Unknown")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if the value is blank (null or empty text).",
  },
  {
    name: "ISNULL",
    params: [req("value", "Unknown")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Legacy null check. TRUE if the value is null.",
    lintNotes: [
      {
        id: "prefer-isblank",
        message:
          "Prefer ISBLANK over ISNULL; ISBLANK also treats empty text as blank.",
      },
    ],
  },
  {
    name: "ISNUMBER",
    params: [req("text", "Text")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if the text value is a valid number.",
  },
  {
    name: "ISPICKVAL",
    params: [req("picklist", "Picklist"), req("text_literal", "Text")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if a picklist field equals a given value.",
  },
  {
    name: "NULLVALUE",
    params: [req("expression", "Unknown"), req("substitute", "Unknown")],
    returnType: sameAsArg(0),
    contexts: "all",
    simulatable: true,
    lintNotes: [
      {
        id: "prefer-blankvalue",
        message:
          "Prefer BLANKVALUE over NULLVALUE; text fields are never null, only blank, so NULLVALUE misses them.",
      },
    ],
    docsUrl: DOCS,
    summary: "Returns a substitute value when the expression is null.",
  },
  {
    name: "BLANKVALUE",
    params: [req("expression", "Unknown"), req("substitute", "Unknown")],
    returnType: sameAsArg(0),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Returns a substitute value when the expression is blank.",
  },

  // --- Text ---------------------------------------------------------------
  {
    name: "LEN",
    params: [req("text", "Text")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Number of characters in a text value.",
  },
  {
    name: "LEFT",
    params: [req("text", "Text"), req("num_chars", "Number")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Leftmost characters of a text value.",
  },
  {
    name: "RIGHT",
    params: [req("text", "Text"), req("num_chars", "Number")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rightmost characters of a text value.",
  },
  {
    name: "MID",
    params: [
      req("text", "Text"),
      req("start_num", "Number"),
      req("num_chars", "Number"),
    ],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Substring starting at a position for a number of characters.",
  },
  {
    name: "TRIM",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Removes leading and trailing spaces.",
  },
  {
    name: "UPPER",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts text to uppercase.",
  },
  {
    name: "LOWER",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts text to lowercase.",
  },
  {
    name: "CONTAINS",
    params: [req("text", "Text"), req("compare_text", "Text")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if a text value contains a substring.",
  },
  {
    name: "BEGINS",
    params: [req("text", "Text"), req("compare_text", "Text")],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if a text value begins with a substring.",
  },
  {
    name: "FIND",
    params: [
      req("search_text", "Text"),
      req("text", "Text"),
      opt("start_num", "Number"),
    ],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Position of a substring within a text value.",
  },
  {
    name: "SUBSTITUTE",
    params: [
      req("text", "Text"),
      req("old_text", "Text"),
      req("new_text", "Text"),
    ],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Replaces occurrences of a substring with another.",
  },
  {
    name: "TEXT",
    params: [req("value", "Unknown")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts a number, date, datetime, or picklist to text.",
  },
  {
    name: "VALUE",
    params: [req("text", "Text")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts a text value to a number.",
  },
  {
    name: "CONCATENATE",
    params: [rest("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Joins several text values into one.",
  },
  {
    name: "SUBSTR",
    params: [
      req("text", "Text"),
      req("start_num", "Number"),
      opt("num_chars", "Number"),
    ],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Substring from a 1-based start position, optionally limited in length.",
  },
  {
    name: "INITCAP",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Capitalizes the first letter of each word; lowercases the rest.",
  },
  {
    name: "REVERSE",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Reverses the characters of a text value.",
  },
  {
    name: "ASCII",
    params: [req("text", "Text")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Numeric code point of the first character of a text value.",
  },
  {
    name: "CHR",
    params: [req("number", "Number")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Character for a numeric code point.",
  },
  {
    name: "IN",
    params: [req("value", "Unknown"), rest("compare", "Unknown")],
    returnType: fixed("Boolean"),
    contexts: "all",
    // Not simulated: the oracle's IN semantics are not reproducible from the
    // corpus (e.g. IN("Left", "Left") → false), so per rule 9 it refuses rather
    // than guess (VERIFICATION.md).
    simulatable: false,
    docsUrl: DOCS,
    summary: "TRUE if the first value equals any of the remaining values.",
  },
  {
    name: "IFERROR",
    params: [req("expression", "Unknown"), req("fallback", "Unknown")],
    returnType: sameAsArg(1),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Returns a fallback value if the expression evaluates to an error.",
  },

  // --- Math ---------------------------------------------------------------
  {
    name: "ABS",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Absolute value of a number.",
  },
  {
    name: "ROUND",
    params: [req("number", "Number"), req("num_digits", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rounds a number to a number of digits (round half up).",
  },
  {
    name: "FLOOR",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rounds a number down to the nearest integer.",
  },
  {
    name: "CEILING",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rounds a number up to the nearest integer.",
  },
  {
    name: "MOD",
    params: [req("number", "Number"), req("divisor", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Remainder after dividing a number by a divisor.",
  },
  {
    name: "SQRT",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Positive square root of a number.",
  },
  {
    name: "MAX",
    params: [rest("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Largest of the given numbers.",
  },
  {
    name: "MIN",
    params: [rest("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Smallest of the given numbers.",
  },
  {
    name: "POWER",
    params: [req("number", "Number"), req("power", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Raises a number to a power.",
  },
  {
    name: "TRUNC",
    params: [req("number", "Number"), opt("num_digits", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Truncates a number to a number of digits (toward zero).",
  },
  {
    name: "MFLOOR",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rounds a number down toward negative infinity (mathematical floor).",
  },
  {
    name: "MCEILING",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Rounds a number up toward positive infinity (mathematical ceiling).",
  },
  // Transcendentals (LN/LOG/EXP/SIN/COS/TAN/ASIN/ACOS/ATAN/ATAN2) are
  // intentionally NOT simulated: Salesforce computes them as non-correctly-rounded
  // doubles (Java StrictMath) that differ from JS Math in the last ULP, so a
  // faithful value cannot be reproduced client-side. Per rule 1 they refuse to
  // simulate rather than ship a subtly-wrong answer (VERIFICATION.md).

  // --- Date & time --------------------------------------------------------
  {
    name: "TODAY",
    params: [],
    returnType: fixed("Date"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The current date.",
  },
  {
    name: "NOW",
    params: [],
    returnType: fixed("Datetime"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The current date and time.",
  },
  {
    name: "DATE",
    params: [
      req("year", "Number"),
      req("month", "Number"),
      req("day", "Number"),
    ],
    returnType: fixed("Date"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Builds a date from year, month, and day.",
  },
  {
    name: "DATEVALUE",
    params: [req("expression", "Text")],
    returnType: fixed("Date"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts text or a datetime to a date.",
  },
  {
    name: "YEAR",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The year of a date.",
  },
  {
    name: "MONTH",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The month (1–12) of a date.",
  },
  {
    name: "DAY",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The day of the month (1–31) of a date.",
  },
  {
    name: "ADDMONTHS",
    params: [req("date", "Date"), req("num", "Number")],
    returnType: fixed("Date"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Adds a number of months to a date.",
  },

  // --- Org-state / change tracking (restricted, not simulatable) ----------
  {
    name: "PRIORVALUE",
    params: [req("field", "Unknown")],
    returnType: sameAsArg(0),
    contexts: CHANGE_CONTEXTS,
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "The previous value of a field. Not available in simulation (org state).",
  },
  {
    name: "ISCHANGED",
    params: [req("field", "Unknown")],
    returnType: fixed("Boolean"),
    contexts: CHANGE_CONTEXTS,
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "TRUE if a field changed. Not available in simulation (org state).",
  },
  {
    name: "ISNEW",
    params: [],
    returnType: fixed("Boolean"),
    contexts: CHANGE_CONTEXTS,
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "TRUE if the record is being created. Not available in simulation (org state).",
  },
  {
    name: "VLOOKUP",
    params: [
      req("field_to_return", "Unknown"),
      req("field_on_lookup", "Unknown"),
      req("lookup_value", "Unknown"),
    ],
    returnType: sameAsArg(0),
    contexts: ["validation_rule", "default_value"],
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "Looks up a value from another object. Not available in simulation (org state).",
  },
];
