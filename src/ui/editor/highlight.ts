import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { lex, type TokenKind } from "../../syntax/index.ts";

/**
 * Syntax highlighting driven purely by the lexer's token stream (DESIGN §3.1),
 * so it keeps working even when the parser can't build a tree. Formulas are
 * tiny, so we re-lex the whole document on every change — no incremental state.
 */

const TOKEN_CLASS: Partial<Record<TokenKind, string>> = {
  number: "cm-sf-number",
  string: "cm-sf-string",
  true: "cm-sf-keyword",
  false: "cm-sf-keyword",
  null: "cm-sf-keyword",
  identifier: "cm-sf-field",
  operator: "cm-sf-operator",
  lparen: "cm-sf-punctuation",
  rparen: "cm-sf-punctuation",
  comma: "cm-sf-punctuation",
  dot: "cm-sf-punctuation",
  error: "cm-sf-error",
};

const marks = new Map<string, Decoration>();
function mark(cls: string): Decoration {
  let d = marks.get(cls);
  if (!d) {
    d = Decoration.mark({ class: cls });
    marks.set(cls, d);
  }
  return d;
}

function buildDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const token of lex(doc).tokens) {
    // Comment trivia precedes its token, keeping the range set in order.
    for (const tr of token.leadingTrivia) {
      if (tr.kind === "comment" && tr.span.end > tr.span.start) {
        builder.add(tr.span.start, tr.span.end, mark("cm-sf-comment"));
      }
    }
    const cls = TOKEN_CLASS[token.kind];
    if (cls && token.span.end > token.span.start) {
      builder.add(token.span.start, token.span.end, mark(cls));
    }
  }
  return builder.finish();
}

export const sfHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString());
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.state.doc.toString());
      }
    }
  },
  { decorations: (v) => v.decorations },
);
