import { lex } from "../../syntax/index.ts";

/**
 * Whether a formula's source contains an actual `/* ... *\/` comment, as
 * opposed to the bare substring "/*" (which can appear inside a string
 * literal without being a comment). `NodeBase.comments` is never populated by
 * the parser, so this goes straight to the lexer's token stream — the same
 * source the formatter's `attachComments` reads — rather than trusting AST
 * comment fields or a naive string search.
 */
export function hasComments(source: string): boolean {
  const { tokens } = lex(source);
  return tokens.some((token) =>
    token.leadingTrivia.some((trivia) => trivia.kind === "comment"),
  );
}
