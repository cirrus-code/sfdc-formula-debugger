export const syntax = {
  lexer: {
    unterminatedComment: "Unterminated comment: missing closing '*/'.",
    unterminatedString: "Unterminated string literal.",
    unexpectedDollar: "Unexpected '$': expected a global name.",
    unexpectedBang: "Unexpected '!'.",
    unexpectedPipe: "Unexpected '|'. For logical OR, use '||' or OR().",
    nestedComment:
      "Block comments do not nest — this comment ends at the first '*/'.",
    unexpectedCharacter: (c: string) => `Unexpected character '${c}'.`,
  },
  parser: {
    unexpectedTrailingInput: "Unexpected trailing input after the formula.",
    expectedFieldName: "Expected a field name after '.'.",
    expectedArgSeparator: "Expected ',' or ')' in argument list.",
    expectedClosingParenForCall: "Expected ')' to close the function call.",
    expectedClosingParenForGroup: "Expected ')' to close the group.",
    expectedExpression: "Expected an expression.",
  },
};
