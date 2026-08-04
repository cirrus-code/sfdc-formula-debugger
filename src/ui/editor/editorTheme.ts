import { EditorView } from "@codemirror/view";
import { palette, syntax, theme } from "../../theme/theme.ts";

/**
 * CodeMirror theme derived from the central branding palette (theme/theme.ts).
 * The editor is the page's centerpiece "instrument screen": it sits on the
 * deepest background layer (palette.well) inside the reticle frame, and its
 * tooltips/completions carry the same panel chrome as the rest of the UI.
 */
export const sfEditorTheme = EditorView.theme(
  {
    "&": {
      color: palette.text,
      backgroundColor: palette.well,
      fontSize: "15px",
      borderRadius: "12px",
      border: `1px solid ${palette.border}`,
    },
    ".cm-content": {
      fontFamily: theme.font.mono,
      padding: "16px 18px",
      caretColor: palette.accent,
      lineHeight: "1.65",
    },
    "&.cm-focused": { outline: "none" },
    "&.cm-editor.cm-focused": {
      borderColor: `${palette.accent}66`,
      boxShadow: `0 0 0 3px ${palette.accent}1f, 0 0 28px ${palette.accent}14`,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: palette.accent,
      borderLeftWidth: "2px",
    },
    // drawSelection's drawn layer is the only selection paint. The focused
    // selector must mirror the base theme's `&dark.cm-focused > .cm-scroller >
    // ...` structure — anything shorter loses the specificity race and the
    // base #233 renders instead of this color.
    ".cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: `${palette.accent}2e`,
      },
    // Keep the native selection invisible even where drawSelection's own hide
    // rule (scoped to .cm-line) doesn't reach, and over page-level ::selection
    // styling like global.css's. Declaring `color` is load-bearing: Firefox
    // (Gecko 153+) treats a transparent selection with no declared color as
    // unstyled and paints the system Highlight/HighlightText pair over the
    // text; currentColor suppresses that while keeping token colors.
    ".cm-content ::selection, .cm-content::selection": {
      backgroundColor: "transparent !important",
      color: "currentColor !important",
    },
    ".cm-placeholder": { color: palette.textMuted, fontStyle: "italic" },
    // highlightSpecialChars' placeholder dot for invisible/confusable paste
    // artifacts (FormulaEditor.tsx) — same danger red as error diagnostics,
    // so a stray zero-width space reads as a problem at a glance.
    ".cm-specialChar": { color: palette.danger },

    ".cm-gutters": {
      backgroundColor: "transparent",
      color: palette.textMuted,
      border: "none",
    },

    // Tooltips (hover docs, autocomplete, lint) share the panel chrome.
    ".cm-tooltip": {
      backgroundColor: palette.surface,
      color: palette.text,
      border: `1px solid ${palette.border}`,
      borderRadius: "8px",
      boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.8)",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: theme.font.mono,
      fontSize: "13px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "3px 8px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: `${palette.accent}26`,
      color: palette.text,
    },
    ".cm-completionLabel": { color: palette.text },
    ".cm-completionMatchedText": {
      color: palette.accent,
      textDecoration: "none",
      fontWeight: "600",
    },
    ".cm-completionDetail": {
      color: palette.textMuted,
      fontStyle: "normal",
      fontSize: "11px",
      marginLeft: "0.6em",
    },
    ".cm-tooltip.cm-completionInfo": {
      fontFamily: theme.font.mono,
      fontSize: "12px",
      padding: "6px 10px",
      maxWidth: "320px",
    },
    ".cm-diagnostic": {
      fontFamily: theme.font.mono,
      fontSize: "12.5px",
      padding: "5px 8px 5px 10px",
    },
    ".cm-diagnostic-error": { borderLeft: `3px solid ${palette.danger}` },
    ".cm-diagnostic-warning": { borderLeft: `3px solid ${palette.warning}` },
    ".cm-diagnostic-info": { borderLeft: `3px solid ${palette.accent}` },

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
