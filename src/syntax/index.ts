/**
 * syntax/ — lexer, parser (recursive descent + Pratt), AST types, spans, comments.
 *
 * Bottom of the stack: zero dependencies on any layer above, and no knowledge of
 * specific functions (names are just identifiers at parse time). Lexing never
 * fails; parsing recovers and always returns `{ ast, diagnostics[] }`.
 */
export {};
