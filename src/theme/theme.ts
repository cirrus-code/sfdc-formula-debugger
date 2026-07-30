/**
 * Single source of truth for branding and visual identity.
 *
 * Keep the product name, palette, fonts, and any cross-linking here so a
 * rebrand is a one-file change — no Salesforce semantics should leak into
 * components. Product *copy* is translatable prose and lives in i18n/
 * (en/copy.ts), not here.
 *
 * Visual direction: "calibrated instrument." The tool's promise is
 * Salesforce-internals accuracy, so the page reads as a precision bench
 * instrument — ink field, blueprint grid, hairline module panels, phosphor
 * signal accent, LED readout — with an Instrument Serif nameplate as the one
 * editorial counterpoint. The UI is deliberately all-mono.
 */

export const product = {
  name: "Formula Debugger",
  /**
   * Cross-link to the Cirrus platform the tool belongs to. Dormant until the
   * platform site is live — set to "https://cirrus.tools" to show the link.
   */
  platformUrl: null as string | null,
  /** Public source repository, linked in the footer. */
  repoUrl: "https://github.com/cirrus-code/sfdc-formula-analyzer",
} as const;

export const palette = {
  /** Page field — near-black cold ink. */
  bg: "#070b14",
  /** Panel surfaces, one step above the field. */
  surface: "#0d1424",
  /** Deepest layer: the editor's "screen". */
  well: "#05080f",
  border: "#202c49",
  text: "#e3e9f8",
  textMuted: "#8ea0c4",
  /** Phosphor signal — the single loud color on the page. */
  accent: "#3fe0b0",
  /** Ink for text set on top of the accent (filled buttons). */
  accentText: "#052019",
  danger: "#ff6b85",
  warning: "#f2b45c",
} as const;

/** Editor syntax-token colors, keyed to lexer token classes. */
export const syntax = {
  number: "#6fd6ff",
  string: "#efb080",
  keyword: "#b9a3ff",
  field: "#93b4ff",
  operator: "#c9d2ea",
  punctuation: "#6f7ea6",
  comment: "#5c6a8f",
  error: "#ff6b85",
} as const;

export const font = {
  /** Nameplate only — everything else is mono. */
  display: "'Instrument Serif', 'Iowan Old Style', Georgia, serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

/**
 * Mirror the theme onto CSS custom properties (`--sfa-*`) so global.css can
 * style hover states, backgrounds, and scrollbars without hardcoding a single
 * color outside this module. Called once at boot, before first render.
 */
export function applyThemeVars(
  el: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(palette)) {
    el.style.setProperty(`--sfa-${key}`, value);
  }
  el.style.setProperty("--sfa-font-mono", font.mono);
  el.style.setProperty("--sfa-font-display", font.display);
}

export const theme = {
  product,
  palette,
  syntax,
  font,
} as const;
