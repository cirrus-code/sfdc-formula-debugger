import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
// Deep import — keeps the engine-dependent simplifier out of the eager bundle.
import { diagnose } from "../../features/linter.ts";
import { contextField, setContext } from "./contextField.ts";

/**
 * Full diagnostic pipeline (syntax + semantic + lint) surfaced as CodeMirror
 * lint ranges, scoped to the active formula context. Empty/whitespace-only input is
 * treated as "nothing to report" so the editor doesn't nag before the user has
 * typed anything.
 */
export const sfLinter = linter(
  (view) => {
    const doc = view.state.doc.toString();
    if (doc.trim() === "") {
      return [];
    }

    const contextId = view.state.field(contextField);
    const len = doc.length;
    return diagnose(doc, contextId).map((d): CmDiagnostic => {
      let from = Math.max(0, Math.min(d.span.start, len));
      let to = Math.max(from, Math.min(d.span.end, len));
      // A zero-width range renders nothing; nudge it to cover one position.
      if (from === to) {
        if (to < len) {
          to += 1;
        } else {
          from = Math.max(0, from - 1);
        }
      }
      return {
        from,
        to,
        severity: d.severity,
        message: d.message,
        source: d.code,
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
