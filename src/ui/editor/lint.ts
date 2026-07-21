import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { parse } from "../../syntax/index.ts";

/**
 * Positioned syntax diagnostics from the parser, surfaced as CodeMirror lint
 * ranges. Empty/whitespace-only input is treated as "nothing to report" so the
 * editor doesn't nag before the user has typed anything.
 */
export const sfLinter = linter(
  (view) => {
    const doc = view.state.doc.toString();
    if (doc.trim() === "") {return [];}

    const len = doc.length;
    return parse(doc).diagnostics.map((d): CmDiagnostic => {
      let from = Math.max(0, Math.min(d.span.start, len));
      let to = Math.max(from, Math.min(d.span.end, len));
      // A zero-width range renders nothing; nudge it to cover one position.
      if (from === to) {
        if (to < len) {to += 1;}
        else {from = Math.max(0, from - 1);}
      }
      return { from, to, severity: d.severity, message: d.message, source: d.code };
    });
  },
  { delay: 120 },
);
