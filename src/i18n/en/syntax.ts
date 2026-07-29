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
    invalidEscape: (c: string) =>
      `Invalid escape '\\${c}' in string literal. Salesforce only allows \\n \\r \\t \\N \\R \\T \\" \\' \\\\.`,
  },
  parser: {
    unexpectedTrailingInput: "Unexpected trailing input after the formula.",
    expectedFieldName: "Expected a field name after '.'.",
    expectedArgSeparator: "Expected ',' or ')' in argument list.",
    expectedClosingParenForCall: "Expected ')' to close the function call.",
    expectedClosingParenForGroup: "Expected ')' to close the group.",
    expectedExpression: "Expected an expression.",
    nestingTooDeep:
      "Formula is nested too deeply to analyze; simplify the expression.",
  },
};
