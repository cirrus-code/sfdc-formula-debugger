/**
 * Boolean-simplifier step titles and suggestion messages (DESIGN §8.2),
 * rendered in the Simplify panel's step log. Formula snippets and
 * operator/function-name tokens (e.g. "AND", "=", the rendered rewrite
 * itself) are passed in as string/boolean params rather than hardcoded —
 * they come from the evaluator/formatter, not from prose. Salesforce
 * literals TRUE/FALSE that appear inside a message are formula-language
 * tokens, not English words; a translation keeps them and only renders the
 * surrounding words in the target language.
 */
export const simplifier = {
  redundantParens: {
    title: "Remove redundant parentheses",
  },
  constantFold: {
    title: "Fold constant expression",
  },
  ifLiteralCondition: {
    takeBranch: (branch: boolean) =>
      `Take the ${branch ? "TRUE" : "FALSE"} branch`,
    takeFalseBranchNullCondition:
      "Take the FALSE branch (NULL condition is false)",
  },
  booleanShapedIf: {
    isX: "IF(x, TRUE, FALSE) is x",
    isNotX: "IF(x, FALSE, TRUE) is NOT(x)",
    suggestion: (cond: string) =>
      `Equivalent to ${cond} — unless it is blank (a blank condition takes ` +
      "the FALSE branch here, but stays blank on its own).",
  },
  doubleNegation: {
    title: "Double negation cancels",
  },
  negatedEquality: {
    title: (op: string, flipped: string) => `NOT(a ${op} b) is a ${flipped} b`,
  },
  flattenLogical: {
    title: (name: string) => `Flatten nested ${name}`,
  },
  identityLaw: {
    title: (identity: boolean, name: string) =>
      `${identity ? "TRUE" : "FALSE"} is the identity of ${name}`,
  },
  shortCircuit: {
    constant: (name: string, annihilator: boolean) =>
      `${name} short-circuits at ${annihilator ? "TRUE" : "FALSE"}`,
    truncated: (annihilator: boolean) =>
      `Arguments after ${annihilator ? "TRUE" : "FALSE"} are unreachable`,
  },
  idempotence: {
    title: "Repeated condition is redundant",
  },
  absorption: {
    title: "Absorption: the outer condition already decides",
  },
  deMorgan: {
    suggestion: (rewritten: string) =>
      `De Morgan: ${rewritten} — equivalent only if no operand ` +
      "can be blank (NOT of a blank is blank here, which AND/OR then treat " +
      "as FALSE).",
  },
  annihilator: {
    suggestion: (name: string, annihilator: boolean) =>
      `This ${name} always returns ${annihilator ? "TRUE" : "FALSE"} — ` +
      "equivalent to the constant unless an earlier argument produces " +
      "#Error!.",
  },
  orderingNegation: {
    suggestion: (flipped: string) =>
      `Equivalent to ${flipped} — only if neither ` +
      "operand can be blank (comparisons against blank are FALSE on both " +
      "sides of the NOT).",
  },
  caseChain: {
    suggestion: (caseCall: string) =>
      `This IF chain reads as ${caseCall} — verify blank handling ` +
      "before switching (CASE compares blanks its own way).",
  },
};
