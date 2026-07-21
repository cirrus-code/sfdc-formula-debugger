import { StateEffect, StateField } from "@codemirror/state";
import { DEFAULT_CONTEXT_ID } from "../../registry/index.ts";

/**
 * The active formula context, held in editor state so the linter can read it
 * live. App dispatches `setContext` when the context picker changes; the linter
 * refreshes on that effect (see lint.ts `needsRefresh`).
 */
export const setContext = StateEffect.define<string>();

export const contextField = StateField.define<string>({
  create: () => DEFAULT_CONTEXT_ID,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setContext)) {next = effect.value;}
    }
    return next;
  },
});
