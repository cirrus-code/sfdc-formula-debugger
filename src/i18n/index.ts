/**
 * Locale plumbing for every user-facing string in the app.
 *
 * All prose lives in locale packs; `en/` is the reference pack and the
 * source of truth for the catalog's shape. Code never embeds user-visible
 * English — it calls `t()` (or the registry helpers below) at the point
 * where the text is produced. Interpolated messages are plain typed
 * functions, so each locale controls its own word order and pluralization
 * without an ICU dependency.
 *
 * i18n sits at the very bottom of the dependency graph: every layer may
 * import it, and it imports nothing from the rest of src/.
 *
 * Diagnostics and simplifier steps render their text eagerly in the active
 * locale; the app recomputes them from source on every edit, so a locale
 * chosen at boot (before first render) is always consistent. Dynamic
 * locale switching would additionally need a re-parse + re-render — see
 * README.md.
 */
import { en } from "./en/index.ts";

/** Every locale must provide the full shape of the English pack. */
export type LocalePack = typeof en;

let active: LocalePack = en;

/**
 * The active locale's catalog. Call at use time; never cache the returned
 * pack across a potential locale change.
 */
export function t(): LocalePack {
  return active;
}

/** Install a locale pack. Must run before first render to take full effect. */
export function setLocale(pack: LocalePack): void {
  active = pack;
}

/*
 * Registry prose stays in registry/ as the English source of truth
 * (splitting a function's definition across files isn't worth it); locales
 * translate it through sparse overlays. Callers pass the registry's English
 * value as the fallback so these helpers never need to import the registry.
 */

export function localizedFunctionSummary(
  name: string,
  english: string,
): string {
  return active.registry.functionSummaries?.[name] ?? english;
}

export function localizedFunctionLintNote(
  noteId: string,
  english: string,
): string {
  return active.registry.functionLintNotes?.[noteId] ?? english;
}

export function localizedContextLabel(
  contextId: string,
  english: string,
): string {
  return active.registry.contextLabels?.[contextId] ?? english;
}

export function localizedContextNote(
  contextId: string,
  english: string,
): string {
  return active.registry.contextNotes?.[contextId] ?? english;
}

export function localizedContextRuntimeErrorNote(
  contextId: string,
  english: string,
): string {
  return active.registry.contextRuntimeErrorNotes?.[contextId] ?? english;
}
