/**
 * The English locale pack — the reference pack whose shape defines
 * `LocalePack` (see ../index.ts). Domain files group strings by the layer
 * that produces them. Pack files must not use `as const` (it would narrow
 * values to literal types and force other locales to repeat the English
 * text) and must not import from anywhere else in src/ — i18n is a
 * dependency leaf.
 */
import type { RegistryOverlay } from "../types.ts";
import { checker } from "./checker.ts";
import { copy } from "./copy.ts";
import { linter } from "./linter.ts";
import { simplifier } from "./simplifier.ts";
import { syntax } from "./syntax.ts";
import { ui } from "./ui.ts";

/** English prose for registry data lives in registry/ itself; no overlay. */
const registry: RegistryOverlay = {};

export const en = {
  locale: "en",
  copy,
  ui,
  syntax,
  checker,
  linter,
  simplifier,
  registry,
};
