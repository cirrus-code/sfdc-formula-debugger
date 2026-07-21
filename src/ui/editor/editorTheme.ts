import { EditorView } from "@codemirror/view";
import { palette, syntax, theme } from "../../theme/theme.ts";

/** CodeMirror theme derived from the central branding palette (theme/theme.ts). */
export const sfEditorTheme = EditorView.theme(
  {
    "&": {
      color: palette.text,
      backgroundColor: palette.surface,
      fontSize: "15px",
      borderRadius: "10px",
      border: `1px solid ${palette.border}`,
    },
    ".cm-content": {
      fontFamily: theme.font.mono,
      padding: "14px 16px",
      caretColor: palette.accent,
      lineHeight: "1.6",
    },
    "&.cm-focused": { outline: "none" },
    "&.cm-editor.cm-focused": { boxShadow: `0 0 0 2px ${palette.accent}55` },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.accent },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
      {
        backgroundColor: `${palette.accent}33`,
      },
    ".cm-placeholder": { color: palette.textMuted, fontStyle: "italic" },

    ".cm-sf-number": { color: syntax.number },
    ".cm-sf-string": { color: syntax.string },
    ".cm-sf-keyword": { color: syntax.keyword, fontWeight: "600" },
    ".cm-sf-field": { color: syntax.field },
    ".cm-sf-operator": { color: syntax.operator },
    ".cm-sf-punctuation": { color: syntax.punctuation },
    ".cm-sf-comment": { color: syntax.comment, fontStyle: "italic" },
    ".cm-sf-error": { color: syntax.error, textDecoration: "underline wavy" },
  },
  { dark: true },
);
