/**
 * Single source of truth for branding and visual identity.
 *
 * Branding and hosting are intentionally undecided (standalone microsite vs.
 * platform-domain path). Keep product name, palette, and any platform
 * cross-linking here so a rebrand is a one-file change — no Salesforce
 * semantics and no product copy should leak into components.
 */

export const product = {
  name: "Formula Debugger",
  tagline: "Debug Salesforce formulas in your browser. Nothing leaves the page.",
  /** Marketing surface for the parent platform; link target TBD before launch. */
  platformUrl: null as string | null,
} as const;

export const palette = {
  bg: "#0b1020",
  surface: "#131a2e",
  border: "#26304d",
  text: "#e6ebff",
  textMuted: "#9aa6c7",
  accent: "#4d7cfe",
  accentText: "#ffffff",
  danger: "#ff6b7d",
  warning: "#ffcc66",
} as const;

/** Editor syntax-token colors, keyed to lexer token classes. */
export const syntax = {
  number: "#7ee3c7",
  string: "#f0a97f",
  keyword: "#b48ef2",
  field: "#8fb7ff",
  operator: "#c3cbe6",
  punctuation: "#7c88ab",
  comment: "#5f6b8c",
  error: "#ff6b7d",
} as const;

export const font = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
} as const;

export const theme = {
  product,
  palette,
  syntax,
  font,
} as const;

export type Theme = typeof theme;
