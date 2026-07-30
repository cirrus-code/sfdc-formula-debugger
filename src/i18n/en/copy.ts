/**
 * Product copy. The product *name* is branding, not copy, and
 * stays in theme/theme.ts; nothing here should embed it — interpolate the
 * name at the call site if a locale's copy ever needs it.
 */
export const copy = {
  /** Mirrored statically in index.html for pre-JS rendering and SEO. */
  pageTitle: "Salesforce Formula Debugger",
  tagline:
    "Debug Salesforce formulas in your browser. Nothing leaves the page.",
  badge: "Client-side · No backend",
  footer:
    "Parsing, simulation, everything — runs locally in this tab. Formulas never touch a server.",
  disclaimer:
    "Salesforce is a trademark of Salesforce, Inc. This tool is independent and not affiliated with, endorsed by, or sponsored by Salesforce.",
  about: {
    label: "About this tool",
    sections: [
      {
        heading: "What it is",
        body: "A free, open-source debugger for Salesforce formulas. Paste a formula to get instant highlighting, positioned error messages, linting, one-click formatting, boolean simplification, and a simulator that computes the result from field values you choose.",
      },
      {
        heading: "How it works",
        body: "Everything runs in this tab — there is no server. The formula is parsed and analyzed entirely in your browser, and simulation reproduces Salesforce semantics: exact decimal math, blank-versus-zero handling, and real #Error! outcomes. A shared link packs the formula into the URL itself; that is the only way it ever leaves the page.",
      },
      {
        heading: "Why trust it",
        body: "Simulation is verified against Salesforce's own open-source formula engine and against a real org; the conformance suite passes 100% of comparable cases, and CI refuses anything less. Where behavior can't be reproduced faithfully — functions that depend on live org state — the tool answers \"unsupported\" rather than guessing.",
      },
    ],
  },
};
