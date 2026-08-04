import { describe, expect, it } from "vitest";
import {
  classifyPasteChar,
  codePointHex,
  PASTE_CHAR_PATTERN,
} from "./chars.ts";

describe("chars: classification and editor rendering agree", () => {
  // A drift between these two is exactly the bug this pairing prevents: a
  // character the lexer diagnoses but the editor renders nothing for (or
  // the reverse). Samples span every class: Cf (including an astral tag
  // character), Cc, Zs, Zl.
  const flagged = [
    "\u200B", // zero-width space
    "\uFEFF", // byte-order mark
    "\u00A0", // no-break space
    "\u0600", // Arabic number sign (Cf)
    "\u206C", // inhibit Arabic form shaping (Cf, outside CM's default set)
    "\u0085", // C1 control (NEL)
    "\u2028", // line separator
    "\u3000", // ideographic space
    "\u{E0020}", // tag space (astral Cf)
  ];
  const ordinary = [" ", "\t", "\n", "\r", "A", "1", '"', "(", "\u00E9"];

  it("flags every paste-artifact sample in both", () => {
    for (const ch of flagged) {
      expect(classifyPasteChar(ch), `U+${codePointHex(ch)}`).not.toBeNull();
      expect(PASTE_CHAR_PATTERN.test(ch), `U+${codePointHex(ch)}`).toBe(true);
    }
  });

  it("passes ordinary characters through both", () => {
    for (const ch of ordinary) {
      expect(classifyPasteChar(ch), `U+${codePointHex(ch)}`).toBeNull();
      expect(PASTE_CHAR_PATTERN.test(ch), `U+${codePointHex(ch)}`).toBe(false);
    }
  });
});
