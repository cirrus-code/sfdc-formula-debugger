import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lintGutter } from "@codemirror/lint";
import { completionKeymap } from "@codemirror/autocomplete";
import { sfHighlight } from "./highlight.ts";
import { sfLinter } from "./lint.ts";
import { sfEditorTheme } from "./editorTheme.ts";
import { sfCompletion } from "./completion.ts";
import { sfHover } from "./hover.ts";
import { contextField, setContext } from "./contextField.ts";

interface FormulaEditorProps {
  readonly initialDoc: string;
  readonly contextId: string;
  readonly onChange: (doc: string) => void;
}

/**
 * Uncontrolled CodeMirror editor: it owns the document and reports changes via
 * `onChange`. The parent uses that text only to render side panels, never to
 * feed the value back in, so there is no update loop. The `onChange` ref keeps
 * the update listener from capturing a stale closure. The active context is
 * pushed in as an editor-state effect so the linter can read it live.
 */
export function FormulaEditor({ initialDoc, contextId, onChange }: FormulaEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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
          contextField,
          history(),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          placeholder("Type a Salesforce formula…"),
          sfHighlight,
          sfCompletion,
          sfHover,
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
    viewRef.current = view;

    onChangeRef.current(initialDoc);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Create the editor exactly once; initialDoc is an initial value, not a prop
    // to react to on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setContext.of(contextId) });
  }, [contextId]);

  return <div ref={host} />;
}
