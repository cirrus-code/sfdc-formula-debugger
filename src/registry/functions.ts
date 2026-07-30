import type {
  Arity,
  ContextId,
  FunctionSpec,
  ParamSpec,
  SfType,
  TypeRule,
} from "./types.ts";

/**
 * Function metadata table (DESIGN §4). Entries are typed data literals; a
 * self-consistency test validates them. They drive type checking, availability
 * diagnostics, autocomplete, and hover. Evaluation lives in the engine's
 * builtin table, keyed by function name; a consistency test enforces that it
 * agrees with each entry's `simulatable` flag.
 *
 * `contexts` data is org-verified where possible (corpus/org-availability.json,
 * 2026-07-28; enforced by org-availability.test.ts): each function
 * was save-probed in every context whose metadata container compile-checks
 * formulas — all of them except email templates, whose merge formulas the org
 * never validates at deploy. Availability is still surfaced as a soft warning
 * only; the email context remains best-effort.
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

// Contexts where change-tracking functions are allowed. Org-verified
// (corpus/org-availability.json): validation rules, field updates, and
// approval criteria accept them; workflow RULES reject them ("may not be
// used in this type of formula") — surprising, but the org is authoritative.
const CHANGE_CONTEXTS: readonly ContextId[] = [
  "validation_rule",
  "workflow_field_update",
  "approval_entry",
  "approval_step",
];

// Org-verified (corpus/org-availability.json): functions the OSS engine
// supports but EVERY verifiable product context rejects at save ("Unknown function" /
// "may not be used in this type of formula") — formula fields, validation
// rules, workflow rules/field updates, default values, approval criteria,
// flow formulas, custom buttons, and quick actions all refuse them. They stay
// registered so they parse/highlight/hover, and the checker warns wherever
// they appear (suppressed only in the deploy-unverifiable email context).
const NO_VERIFIED_CONTEXT: readonly ContextId[] = [];

// Org-verified groupings (corpus/org-availability.json): the encode family
// lives only where output is rendered for the web…
const ENCODE_CONTEXTS: readonly ContextId[] = [
  "flow_formula",
  "custom_button_link",
  "email_template",
];
// …and a handful of functions are rejected only by the custom-button compiler.
const ALL_BUT_BUTTON: readonly ContextId[] = [
  "formula_field",
  "validation_rule",
  "workflow_rule",
  "workflow_field_update",
  "default_value",
  "flow_formula",
  "approval_entry",
  "approval_step",
  "quick_action",
  "email_template",
];

// Org-verified (VERIFICATION.md): TRUNC's single-argument form
// only saves in formula fields; every other Tier 1 (compile-checked) context
// requires both arguments. email_template is Tier 2 (deploy never compile-
// checks it) so it's left out — the checker treats Tier 2 as best-effort.
const TRUNC_TWO_ARG_CONTEXTS: readonly ContextId[] = [
  "validation_rule",
  "flow_formula",
  "default_value",
  "workflow_rule",
  "workflow_field_update",
  "approval_entry",
  "approval_step",
  "custom_button_link",
  "quick_action",
];
const TRUNC_CONTEXT_ARITY: Partial<Readonly<Record<ContextId, Arity>>> =
  Object.fromEntries(
    TRUNC_TWO_ARG_CONTEXTS.map((id) => [id, { min: 2, max: 2 }]),
  );

// Transcendental math: real Salesforce functions, but NOT simulatable — they
// compute as non-correctly-rounded doubles (Java StrictMath) whose last ULP a
// client cannot reproduce, so they refuse to simulate rather than
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
    summary:
      "Angle in radians between the positive x-axis and the point (x, y).",
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
    // Any type EXCEPT Boolean: the product rejects ISBLANK(checkbox) at save
    // ("Incorrect argument type", org-verified 2026-07-30).
    params: [{ ...req("value", "Unknown"), rejectTypes: ["Boolean"] }],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if the value is blank (null or empty text).",
  },
  {
    name: "ISNULL",
    // Same Boolean rejection as ISBLANK (org-verified, isnull_bool_arg).
    params: [{ ...req("value", "Unknown"), rejectTypes: ["Boolean"] }],
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
    // The locale argument is undocumented but org-verified as accepted
    // (probe corpus:testUpperLocale).
    params: [req("text", "Text"), opt("locale", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts text to uppercase (optionally locale-aware).",
  },
  {
    name: "LOWER",
    params: [req("text", "Text"), opt("locale", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Converts text to lowercase (optionally locale-aware).",
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
    contexts: NO_VERIFIED_CONTEXT,
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
    contexts: NO_VERIFIED_CONTEXT,
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Substring from a 1-based start position, optionally limited in length.",
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
    contexts: NO_VERIFIED_CONTEXT,
    // Not simulated: the oracle's IN semantics are not reproducible from the
    // corpus (e.g. IN("Left", "Left") → false), so it refuses rather
    // than guess (VERIFICATION.md).
    simulatable: false,
    docsUrl: DOCS,
    summary: "TRUE if the first value equals any of the remaining values.",
  },
  {
    name: "IFERROR",
    params: [req("expression", "Unknown"), req("fallback", "Unknown")],
    returnType: sameAsArg(1),
    contexts: NO_VERIFIED_CONTEXT,
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Returns a fallback value if the expression evaluates to an error.",
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
    contexts: ["custom_button_link"],
    // Not simulated: no corpus row pins whether POWER shares `^`'s verified
    // rules (integer-only exponent, 1e64 cap, precision limits), so it
    // refuses rather than guess (VERIFICATION.md).
    simulatable: false,
    docsUrl: DOCS,
    summary: "Raises a number to a power.",
  },
  {
    name: "TRUNC",
    params: [req("number", "Number"), opt("num_digits", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    contextArity: TRUNC_CONTEXT_ARITY,
    simulatable: true,
    docsUrl: DOCS,
    summary: "Truncates a number to a number of digits (toward zero).",
    lintNotes: [
      {
        id: "trunc-arity-outside-formula-fields",
        message:
          "Only formula fields accept single-argument TRUNC(n); every other context requires both arguments (org-verified).",
      },
    ],
  },
  {
    name: "MFLOOR",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Rounds a number down toward negative infinity (mathematical floor).",
  },
  {
    name: "MCEILING",
    params: [req("number", "Number")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary:
      "Rounds a number up toward positive infinity (mathematical ceiling).",
  },
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
    params: [{ ...req("expression", "Text"), altTypes: ["Datetime"] }],
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
    // Datetime in, Datetime out — the time-of-day is preserved
    // (oracle-verified, testAddMonthsDateTime).
    returnType: sameAsArg(0),
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

  // --- Date & time (additional) --------------------------------------------
  {
    name: "DATETIMEVALUE",
    params: [req("value", "Text")],
    returnType: fixed("Datetime"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: 'Converts "YYYY-MM-DD HH:MM:SS" text (GMT) to a date/time.',
  },
  {
    name: "TIMEVALUE",
    params: [req("value", "Unknown")],
    returnType: fixed("Time"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The time part of a date/time, or parses HH:MM:SS.MS text.",
  },
  {
    name: "TIMENOW",
    params: [],
    returnType: fixed("Time"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The current time of day in GMT.",
  },
  {
    name: "HOUR",
    params: [req("time", "Time")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The hour of a time value (0–23).",
  },
  {
    name: "MINUTE",
    params: [req("time", "Time")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The minute of a time value (0–59).",
  },
  {
    name: "SECOND",
    params: [req("time", "Time")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The second of a time value (0–59).",
  },
  {
    name: "MILLISECOND",
    params: [req("time", "Time")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The millisecond of a time value (0–999).",
  },
  {
    name: "WEEKDAY",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Day of the week for a date: 1 = Sunday … 7 = Saturday.",
  },
  {
    name: "DAYOFYEAR",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The ordinal day of the year (1–366).",
  },
  {
    name: "ISOWEEK",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "ISO-8601 week number of the year (1–53).",
  },
  {
    name: "ISOYEAR",
    params: [req("date", "Date")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "ISO-8601 week-numbering year of a date.",
  },
  {
    name: "UNIXTIMESTAMP",
    params: [req("value", "Unknown")],
    returnType: fixed("Number"),
    // Quick actions alone reject it (org-verified).
    contexts: [
      "formula_field",
      "validation_rule",
      "workflow_rule",
      "workflow_field_update",
      "default_value",
      "flow_formula",
      "approval_entry",
      "approval_step",
      "custom_button_link",
      "email_template",
    ],
    simulatable: true,
    docsUrl: DOCS,
    summary: "Seconds since 1970-01-01 00:00:00 GMT (dates count midnight).",
  },
  {
    name: "FROMUNIXTIME",
    params: [req("seconds", "Number")],
    returnType: fixed("Datetime"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The date/time for a count of seconds since the Unix epoch.",
  },

  // --- Text (additional) ---------------------------------------------------
  {
    name: "LPAD",
    params: [
      req("text", "Text"),
      req("padded_length", "Number"),
      opt("pad_string", "Text"),
    ],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Pads text on the left to a length (truncates when shorter).",
  },
  {
    name: "RPAD",
    params: [
      req("text", "Text"),
      req("padded_length", "Number"),
      opt("pad_string", "Text"),
    ],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Pads text on the right to a length (truncates when shorter).",
  },
  {
    name: "PI",
    params: [],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "The mathematical constant π.",
  },

  // --- Registered, not simulated (semantics unverified or org-state) ------
  // These parse, highlight, hover, and lint; simulation refuses (rule 1)
  // until golden rows pin their behavior — or forever, for org-state values.
  {
    name: "INCLUDES",
    params: [
      req("multiselect_picklist", "Multipicklist"),
      req("text_literal", "Text"),
    ],
    returnType: fixed("Boolean"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "TRUE if a multi-select picklist includes a value.",
  },
  {
    name: "REGEX",
    params: [req("text", "Text"), req("regex_text", "Text")],
    returnType: fixed("Boolean"),
    contexts: [
      "validation_rule",
      "workflow_field_update",
      "default_value",
      "flow_formula",
      "approval_entry",
      "approval_step",
      "quick_action",
      "email_template",
    ],
    // Salesforce matches with Java's regex dialect, which differs from
    // JavaScript's in ways a client cannot faithfully bridge (possessive
    // quantifiers, Java-only classes) — refuse rather than subtly mismatch.
    simulatable: false,
    docsUrl: DOCS,
    summary: "TRUE if the text matches the (Java-dialect) regular expression.",
  },
  {
    name: "DISTANCE",
    params: [
      req("location1", "Unknown"),
      req("location2", "Unknown"),
      req("unit", "Text"),
    ],
    returnType: fixed("Number"),
    contexts: ALL_BUT_BUTTON,
    simulatable: false,
    docsUrl: DOCS,
    summary: 'Distance between two locations in "mi" or "km".',
  },
  {
    name: "GEOLOCATION",
    params: [req("latitude", "Number"), req("longitude", "Number")],
    returnType: fixed("Unknown"),
    contexts: ALL_BUT_BUTTON,
    simulatable: false,
    docsUrl: DOCS,
    summary: "A location value for use with DISTANCE.",
  },
  {
    name: "BR",
    params: [],
    returnType: fixed("Text"),
    contexts: ALL_BUT_BUTTON,
    simulatable: true,
    docsUrl: DOCS,
    summary: "A line break (a literal <br> tag in formula-field output).",
    lintNotes: [
      {
        id: "br-context-rendering",
        message:
          "BR() renders as a literal <br> tag in formula fields but as a real newline in flow formulas (org-verified).",
      },
    ],
  },
  {
    name: "CASESAFEID",
    params: [req("id", "Text")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: false,
    docsUrl: DOCS,
    summary: "Converts a 15-character ID to its case-safe 18-character form.",
    lintNotes: [
      {
        id: "casesafeid-unsupported-simulation",
        message:
          "Simulation refuses: Salesforce checks the input against the org's live key-prefix registry (which object/record type it names), and that registry is org state a client can't see, so the input's validity is never guessed. The 15-to-18 suffix itself is a public, deterministic algorithm: split the id into three 5-character chunks, and for each chunk build a 5-bit mask (one bit per character, set when that character is an uppercase letter), then look up the mask in the alphabet A-Z0-5 to get that chunk's extra suffix character.",
      },
    ],
  },
  {
    name: "HTMLENCODE",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: ENCODE_CONTEXTS,
    simulatable: true,
    docsUrl: DOCS,
    summary: "Escapes text for HTML output.",
  },
  {
    name: "JSENCODE",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: ENCODE_CONTEXTS,
    simulatable: true,
    docsUrl: DOCS,
    summary: "Escapes text for JavaScript string literals.",
  },
  {
    name: "JSINHTMLENCODE",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: ENCODE_CONTEXTS,
    simulatable: true,
    docsUrl: DOCS,
    summary: "Applies JSENCODE then HTMLENCODE.",
  },
  {
    name: "URLENCODE",
    params: [req("text", "Text")],
    returnType: fixed("Text"),
    contexts: ENCODE_CONTEXTS,
    simulatable: true,
    docsUrl: DOCS,
    summary: "Escapes text for use in a URL.",
  },
  {
    name: "HYPERLINK",
    params: [
      req("url", "Text"),
      req("friendly_name", "Text"),
      opt("target", "Text"),
    ],
    returnType: fixed("Text"),
    contexts: ["formula_field", "flow_formula", "email_template"],
    simulatable: false,
    docsUrl: DOCS,
    summary: "A clickable link (rendering depends on the display context).",
  },
  {
    name: "IMAGE",
    params: [
      req("image_url", "Text"),
      req("alternate_text", "Text"),
      opt("height", "Number"),
      opt("width", "Number"),
    ],
    returnType: fixed("Text"),
    contexts: ["formula_field", "email_template"],
    simulatable: false,
    docsUrl: DOCS,
    summary: "An inline image (rendering depends on the display context).",
  },
  {
    name: "GETSESSIONID",
    params: [],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: false,
    docsUrl: DOCS,
    summary: "The current session ID. Not available in simulation (org state).",
  },
  {
    name: "CURRENCYRATE",
    params: [req("iso_code", "Text")],
    returnType: fixed("Number"),
    contexts: "all",
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "Conversion rate for a currency ISO code. Not available in simulation (org state).",
  },
  {
    name: "ISCLONE",
    params: [],
    returnType: fixed("Boolean"),
    contexts: CHANGE_CONTEXTS,
    simulatable: false,
    docsUrl: DOCS,
    summary:
      "TRUE if the record is a clone of another record. Not available in simulation (org state).",
  },
  {
    name: "FORMATDURATION",
    params: [req("value", "Unknown"), opt("include_days_or_value2", "Unknown")],
    returnType: fixed("Text"),
    contexts: "all",
    simulatable: true,
    docsUrl: DOCS,
    summary: "Formats a number of seconds as HH:MI:SS (optionally with days).",
  },
  {
    name: "IMAGEPROXYURL",
    params: [req("url", "Text")],
    returnType: fixed("Text"),
    contexts: ["email_template"],
    simulatable: false,
    docsUrl: DOCS,
    summary: "A proxied URL for securely loading an external image.",
  },
  {
    name: "JUNCTIONIDLIST",
    params: [rest("id", "Text")],
    returnType: fixed("Unknown"),
    contexts: ["email_template"],
    simulatable: false,
    docsUrl: DOCS,
    summary: "Builds a JunctionIDList from record IDs.",
  },
  {
    name: "PICKLISTCOUNT",
    params: [req("multiselect_picklist", "Multipicklist")],
    returnType: fixed("Number"),
    contexts: [
      "formula_field",
      "validation_rule",
      "workflow_field_update",
      "default_value",
      "flow_formula",
      "quick_action",
      "custom_button_link",
      "email_template",
    ],
    simulatable: true,
    docsUrl: DOCS,
    summary: "The number of selected values in a multi-select picklist.",
  },
];
