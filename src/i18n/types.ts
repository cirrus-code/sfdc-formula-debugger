/**
 * Sparse translation overlays for prose that lives in registry/ data
 * (function summaries, lint notes, context labels/notes). The registry
 * remains the English source of truth; a locale supplies only the entries
 * it translates, and lookups fall back to the registry's English.
 */
export interface RegistryOverlay {
  /** Keyed by function name (e.g. "ISBLANK"). */
  readonly functionSummaries?: Readonly<Record<string, string>>;
  /** Keyed by lint-note id (e.g. "prefer-isblank"). */
  readonly functionLintNotes?: Readonly<Record<string, string>>;
  /** Keyed by formula-context id. */
  readonly contextLabels?: Readonly<Record<string, string>>;
  /** Keyed by formula-context id. */
  readonly contextNotes?: Readonly<Record<string, string>>;
}
