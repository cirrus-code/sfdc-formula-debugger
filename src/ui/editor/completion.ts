import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { FUNCTIONS } from "../../registry/index.ts";
import { signature } from "./signature.ts";

const FUNCTION_OPTIONS: readonly Completion[] = FUNCTIONS.map((spec) => ({
  label: spec.name,
  type: "function",
  detail: signature(spec),
  info: spec.summary,
  // Insert the open paren so the signature/hover kicks in immediately.
  apply: `${spec.name}(`,
}));

function sfCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }
  return {
    from: word.from,
    options: FUNCTION_OPTIONS,
    validFor: /^[A-Za-z0-9_]*$/,
  };
}

export const sfCompletion = autocompletion({
  override: [sfCompletionSource],
  icons: false,
});
