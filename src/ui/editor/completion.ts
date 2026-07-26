import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { FUNCTIONS } from "../../registry/index.ts";
import { localizedFunctionSummary } from "../../i18n/index.ts";
import { signature } from "./signature.ts";

// Built lazily: the locale is installed at boot, after this module loads, so
// summaries must not be resolved at import time.
let functionOptions: readonly Completion[] | undefined;

function getFunctionOptions(): readonly Completion[] {
  functionOptions ??= FUNCTIONS.map((spec) => ({
    label: spec.name,
    type: "function",
    detail: signature(spec),
    info: localizedFunctionSummary(spec.name, spec.summary),
    // Insert the open paren so the signature/hover kicks in immediately.
    apply: `${spec.name}(`,
  }));
  return functionOptions;
}

function sfCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }
  return {
    from: word.from,
    options: getFunctionOptions(),
    validFor: /^[A-Za-z0-9_]*$/,
  };
}

export const sfCompletion = autocompletion({
  override: [sfCompletionSource],
  icons: false,
});
