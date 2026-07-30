/**
 * Strings rendered by React components and CodeMirror extensions, grouped by
 * surface. Formula-language tokens (function names, TRUE/FALSE, the literal
 * "#Error!" Salesforce shows) are not prose and stay in code.
 */
export const ui = {
  editor: {
    placeholder: "Type a Salesforce formula...",
  },
  toolbar: {
    format: "Format",
    formatTitle: "Format (Shift+Alt+F)",
    contextLabel: "Context",
    contextUnverifiedSuffix: " (unverified)",
  },
  problems: {
    label: "Problems",
    none: "no problems",
    count: (n: number) => `${n} problem${n === 1 ? "" : "s"}`,
    clean: "Parses correctly.",
    docsLink: "docs ↗",
  },
  simulate: {
    label: "Simulate",
    blankFieldsAs: "Blank fields as",
    blankAsZeroes: "zeroes",
    blankAsBlanks: "blanks",
    noFields: "No fields referenced.",
    blankCheckbox: "blank",
    nullField: "null",
    valuePlaceholder: "value",
    blankResult: "(blank)",
    resultLabel: "Result",
    cannotSimulate: (functionName: string) =>
      `Cannot simulate: ${functionName} depends on org state`,
    errorResult: "Salesforce would show #Error! here",
    copyLink: "Copy link",
    copied: "Copied!",
    linkInUrlBar: "Link is in the URL bar",
    copyLinkTitle: "Copy a link that restores this formula, inputs, and result",
  },
  simplify: {
    label: "Simplify",
    apply: "Apply",
    applyWouldRemoveComments: "Applying would remove the formula's comments",
    applyReplaces: "Replace the formula with the simplified version",
  },
  hover: {
    notSimulatable: "Not available in simulation (depends on org state).",
    salesforceDocs: "Salesforce docs ↗",
  },
  footer: {
    platformLink: (host: string) => `${host} ↗`,
    sourceLink: "GitHub ↗",
  },
};
