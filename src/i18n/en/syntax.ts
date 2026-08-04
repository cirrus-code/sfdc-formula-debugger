/**
 * Unicode character names shown in paste-artifact diagnostics, keyed by
 * uppercase code-point hex without the `U+` prefix. Characters missing here
 * still get a diagnostic — just without the parenthesized name.
 */
const CHARACTER_NAMES: Record<string, string> = {
  "200B": "zero-width space",
  "200C": "zero-width non-joiner",
  "200D": "zero-width joiner",
  "2060": "word joiner",
  FEFF: "zero-width no-break space / byte-order mark",
  "00AD": "soft hyphen",
  "200E": "left-to-right mark",
  "200F": "right-to-left mark",
  "061C": "Arabic letter mark",
  "202A": "left-to-right embedding",
  "202B": "right-to-left embedding",
  "202C": "pop directional formatting",
  "202D": "left-to-right override",
  "202E": "right-to-left override",
  "2066": "left-to-right isolate",
  "2067": "right-to-left isolate",
  "2068": "first strong isolate",
  "2069": "pop directional isolate",
  "00A0": "no-break space",
  "202F": "narrow no-break space",
  "205F": "medium mathematical space",
  "1680": "ogham space mark",
  "3000": "ideographic space",
  "2002": "en space",
  "2003": "em space",
  "2009": "thin space",
  "200A": "hair space",
  "2028": "line separator",
  "2029": "paragraph separator",
};

/** `U+200B (zero-width space)` or `U+2001` when the name is unknown. */
const charLabel = (hex: string, name: string | null): string =>
  name === null ? `U+${hex}` : `U+${hex} (${name})`;

export const syntax = {
  lexer: {
    unterminatedComment: "Unterminated comment: missing closing '*/'.",
    unterminatedString: "Unterminated string literal.",
    unexpectedDollar: "Unexpected '$': expected a global name.",
    unexpectedBang: "Unexpected '!'.",
    unexpectedPipe: "Unexpected '|'. For logical OR, use '||' or OR().",
    nestedComment:
      "Block comments do not nest — this comment ends at the first '*/'.",
    unexpectedCharacter: (c: string, hex: string | null) =>
      hex === null
        ? `Unexpected character '${c}'.`
        : `Unexpected character '${c}' (U+${hex}).`,
    invalidEscape: (c: string) =>
      `Invalid escape '\\${c}' in string literal. Salesforce only allows \\n \\r \\t \\N \\R \\T \\" \\' \\\\.`,
    characterNames: CHARACTER_NAMES,
    invisibleCharacter: (hex: string, name: string | null, count: number) =>
      (count === 1
        ? `Invisible character ${charLabel(hex, name)}.`
        : `${count}× invisible character ${charLabel(hex, name)}.`) +
      " It takes no space on screen but is not valid in a formula — " +
      "usually a copy-paste artifact from a web page or document.",
    nonstandardSpace: (hex: string, name: string | null, count: number) =>
      (count === 1
        ? `Non-standard space character ${charLabel(hex, name)}.`
        : `${count}× non-standard space character ${charLabel(hex, name)}.`) +
      " Formulas expect regular spaces — usually a copy-paste artifact " +
      "from a web page or document.",
    typographicQuotes:
      "Typographic (curly) quotes are not valid string delimiters — " +
      "use straight quotes (\" or ').",
    confusableCharacter: (c: string, hex: string, replacement: string) =>
      `'${c}' (U+${hex}) is a typographic character — did you mean '${replacement}'?`,
    fixes: {
      removeInvisible: (count: number) =>
        count === 1
          ? "Remove invisible character"
          : `Remove ${count} invisible characters`,
      replaceWithSpace: (count: number) =>
        count === 1
          ? "Replace with a regular space"
          : "Replace with regular spaces",
      straightenQuotes: "Replace with straight quotes",
      replaceWith: (replacement: string) => `Replace with '${replacement}'`,
    },
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
