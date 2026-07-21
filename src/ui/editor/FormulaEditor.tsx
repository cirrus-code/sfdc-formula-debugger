import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lintGutter } from "@codemirror/lint";
import { sfHighlight } from "./highlight.ts";
import { sfLinter } from "./lint.ts";
import { sfEditorTheme } from "./editorTheme.ts";

interface FormulaEditorProps {
  readonly initialDoc: string;
  readonly onChange: (doc: string) => void;
}

/**
 * Uncontrolled CodeMirror editor: it owns the document and reports changes via
 * `onChange`. The parent uses that text only to render side panels, never to
 * feed the value back in, so there is no update loop. The `onChange` ref keeps
 * the update listener from capturing a stale closure.
 */
export function FormulaEditor({ initialDoc, onChange }: FormulaEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) {return;}

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder("Type a Salesforce formula…"),
          sfHighlight,
          sfLinter,
          lintGutter(),
          sfEditorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {onChangeRef.current(u.state.doc.toString());}
          }),
        ],
      }),
    });

    onChangeRef.current(initialDoc);
    return () => view.destroy();
    // Create the editor exactly once; initialDoc is an initial value, not a prop
    // to react to on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} />;
}
