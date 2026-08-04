import {
  forceLinting,
  linter,
  type Action,
  type Diagnostic as CmDiagnostic,
} from "@codemirror/lint";
import type { Text } from "@codemirror/state";
// Deep import — keeps the engine-dependent simplifier out of the eager bundle.
import { diagnose } from "../../features/linter.ts";
import {
  isBlankSource,
  type DiagnosticCode,
  type TextEdit,
} from "../../syntax/index.ts";
import { t } from "../../i18n/index.ts";
import { contextField, setContext } from "./contextField.ts";

// Paste-artifact diagnostics eligible for the combined "fix all" action.
// `invisible-in-string` is deliberately excluded: characters there are part
// of a string literal's value, so removing them changes what the formula
// evaluates to — that stays an individual, explicit action, never bundled.
const FIX_ALL_CODES: ReadonlySet<DiagnosticCode> = new Set([
  "invisible-character",
  "nonstandard-whitespace",
  "confusable-character",
]);

function fixAction(
  name: string,
  edits: readonly TextEdit[],
  docAtLint: Text,
): Action {
  return {
    name,
    apply(view) {
      // The edits address offsets in the document the linter ran against.
      // CodeMirror keeps stale actions clickable while a re-lint is pending
      // (the 120ms debounce), so if the document changed since, dispatching
      // these offsets would edit the wrong text — re-lint instead and let the
      // user click the freshly positioned action.
      if (view.state.doc !== docAtLint) {
        forceLinting(view);
        return;
      }
      view.dispatch({
        changes: edits.map((e) => ({
          from: e.span.start,
          to: e.span.end,
          insert: e.newText,
        })),
      });
    },
  };
}

/**
 * Full diagnostic pipeline (syntax + semantic + lint) surfaced as CodeMirror
 * lint ranges, scoped to the active formula context. Empty/whitespace-only input is
 * treated as "nothing to report" so the editor doesn't nag before the user has
 * typed anything.
 */
export const sfLinter = linter(
  (view) => {
    const docAtLint = view.state.doc;
    const doc = docAtLint.toString();
    // Not trim(): trim() also strips NBSP/BOM-class paste artifacts, which
    // would silence their diagnostics for a document containing only them.
    if (isBlankSource(doc)) {
      return [];
    }

    const contextId = view.state.field(contextField);
    const len = doc.length;
    const diagnostics = diagnose(doc, contextId);

    const fixAllTargets = diagnostics.filter(
      (d) => d.severity === "error" && d.fix && FIX_ALL_CODES.has(d.code),
    );
    const fixAllAction: Action | null =
      fixAllTargets.length >= 2
        ? fixAction(
            t().ui.editor.fixAllSpecialChars(fixAllTargets.length),
            fixAllTargets.flatMap((d) => d.fix!.edits),
            docAtLint,
          )
        : null;

    return diagnostics.map((d): CmDiagnostic => {
      let from = Math.max(0, Math.min(d.span.start, len));
      let to = Math.max(from, Math.min(d.span.end, len));
      // A zero-width range renders nothing; nudge the displayed range to
      // cover one position. This nudges the range only — fix edits below
      // always address the diagnostic's original, un-nudged span.
      if (from === to) {
        if (to < len) {
          to += 1;
        } else {
          from = Math.max(0, from - 1);
        }
      }

      const actions: Action[] = [];
      if (d.fix) {
        actions.push(fixAction(d.fix.title, d.fix.edits, docAtLint));
        if (fixAllAction && fixAllTargets.includes(d)) {
          actions.push(fixAllAction);
        }
      }

      return {
        from,
        to,
        severity: d.severity,
        message: d.message,
        source: d.code,
        ...(actions.length > 0 ? { actions } : {}),
      };
    });
  },
  {
    delay: 120,
    // Re-lint when the context changes, not only on document edits.
    needsRefresh: (update) =>
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setContext)),
      ),
  },
);
