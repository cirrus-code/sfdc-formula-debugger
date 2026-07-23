import { describe, expect, it } from "vitest";
import { parse, type DiagnosticCode } from "../syntax/index.ts";
import { diagnose, lint } from "./linter.ts";

function lintCodes(source: string, contextId = "formula_field"): DiagnosticCode[] {
  const { ast } = parse(source);
  return lint(ast, source, contextId).map((d) => d.code);
}

function parseAndLint(source: string) {
  const { ast } = parse(source);
  return lint(ast, source, "formula_field");
}

describe("linter: hardcoded record IDs", () => {
  it("flags 15- and 18-character ID-shaped string literals", () => {
    expect(lintCodes('Id = "0012w00001Abcde"')).toContain("hardcoded-id");
    expect(lintCodes('Id = "0012w00001AbcdeAAA"')).toContain("hardcoded-id");
  });

  it("ignores ordinary strings, words, and numbers of coincidental length", () => {
    expect(lintCodes('Name = "Closed Won"')).toEqual([]);
    // 15 letters, no digit.
    expect(lintCodes('Name = "ABCDEFGHIJKLMNO"')).toEqual([]);
    // 15 digits, no letter.
    expect(lintCodes('Name = "123456789012345"')).toEqual([]);
    // Right mix, wrong length.
    expect(lintCodes('Name = "0012w00001Abcd"')).toEqual([]);
  });

  it("anchors the finding to the literal", () => {
    const src = 'Id = "0012w00001Abcde"';
    const { ast } = parse(src);
    const [d] = lint(ast, src, "formula_field");
    expect(d!.span.start).toBe(src.indexOf('"'));
    expect(d!.span.end).toBe(src.length);
  });
});

describe("linter: nested IF depth", () => {
  const nest = (depth: number): string => {
    let src = "0";
    for (let i = 0; i < depth; i++) {
      src = `IF(a, 1, ${src})`;
    }
    return src;
  };

  it("stays quiet at the threshold and fires one finding beyond it", () => {
    expect(lintCodes(nest(3))).toEqual([]);
    expect(lintCodes(nest(4))).toEqual(["deep-if-nesting"]);
    // One finding per chain, reported at the outermost IF — not per level.
    expect(lintCodes(nest(6))).toEqual(["deep-if-nesting"]);
  });

  it("counts depth along a path, not total IF count", () => {
    // Three sibling IFs are fine; nesting is what hurts readability.
    expect(lintCodes("IF(a,1,0) + IF(b,1,0) + IF(c,1,0)")).toEqual([]);
  });
});

describe("linter: TEXT() picklist comparison", () => {
  it("suggests ISPICKVAL for TEXT(field) compared to a string literal", () => {
    const codes = lintCodes('TEXT(StageName) = "Closed Won"');
    expect(codes).toEqual(["prefer-ispickval"]);
    expect(lintCodes('"Closed Won" <> TEXT(StageName)')).toEqual([
      "prefer-ispickval",
    ]);
  });

  it("names the field and the ISPICKVAL rewrite in the message", () => {
    const src = 'TEXT(StageName) = "Closed Won"';
    const { ast } = parse(src);
    const [d] = lint(ast, src, "formula_field");
    expect(d!.message).toContain('ISPICKVAL(StageName, "Closed Won")');
  });

  it("ignores non-field TEXT args, non-equality operators, and globals", () => {
    expect(lintCodes('TEXT(1) = "1"')).toEqual([]);
    expect(lintCodes('TEXT(StageName) & "x"')).toEqual([]);
    expect(lintCodes('TEXT($User.Alias) = "x"')).toEqual([]);
    expect(lintCodes("TEXT(StageName) = Other__c")).toEqual([]);
  });
});

describe("linter: registry lintNotes (discouraged constructs)", () => {
  it("surfaces ISNULL's prefer-ISBLANK note at the callee", () => {
    const src = "ISNULL(Custom__c)";
    const { ast } = parse(src);
    const diags = lint(ast, src, "formula_field");
    expect(diags.map((d) => d.code)).toEqual(["discouraged-function"]);
    expect(diags[0]!.message).toContain("ISBLANK");
    expect(diags[0]!.span).toEqual({ start: 0, end: "ISNULL".length });
  });

  it("surfaces NULLVALUE's prefer-BLANKVALUE note", () => {
    const [d] = parseAndLint("NULLVALUE(Custom__c, 0)");
    expect(d!.code).toBe("discouraged-function");
    expect(d!.message).toContain("BLANKVALUE");
  });
});

describe("linter: character limit", () => {
  const long = `"${"a".repeat(4000)}"`;

  it("warns when source exceeds the context limit, spanning the overflow", () => {
    const { ast } = parse(long);
    const diags = lint(ast, long, "formula_field");
    expect(diags.map((d) => d.code)).toEqual(["char-limit"]);
    expect(diags[0]!.span).toEqual({ start: 3900, end: long.length });
    // The honest phrasing about compiled size (DESIGN §8.4) is load-bearing.
    expect(diags[0]!.message).toMatch(/compiled-size/);
  });

  it("stays quiet under the limit and in contexts without one", () => {
    expect(lintCodes('"short"')).toEqual([]);
    expect(lintCodes(long, "flow_formula")).toEqual([]);
  });
});

describe("diagnose: full pipeline", () => {
  it("merges syntax, analysis, and lint findings in source order", () => {
    // Unknown function (analysis) + hardcoded ID (lint) in one formula.
    const diags = diagnose('BOGUS("0012w00001Abcde")', "formula_field");
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("unknown-function");
    expect(codes).toContain("hardcoded-id");
    const starts = diags.map((d) => d.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("reports nothing on the clean sample formula", () => {
    expect(diagnose("IF(ISBLANK(Amount), 0, Amount * 1.1)", "formula_field"))
      .toEqual([]);
  });
});
