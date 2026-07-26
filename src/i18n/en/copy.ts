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
};
