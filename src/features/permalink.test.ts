import { describe, expect, it } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import {
  decodePermalink,
  encodePermalink,
  type PermalinkState,
} from "./permalink.ts";

const STATE: PermalinkState = {
  context: "formula_field",
  formula: "IF(ISBLANK(Amount), 0, Amount * 1.1) /* keep */",
  fields: {
    Amount: { type: "Currency", value: "100", blank: false },
    "Account.Name": { type: "Text", value: "", blank: true },
  },
  blankMode: "blank",
};

describe("permalink codec", () => {
  it("round-trips full state through a URL-safe string", () => {
    const encoded = encodePermalink(STATE);
    // lz-string's URI-safe alphabet (A-Za-z0-9 + - $): every character is
    // legal in a URL fragment, so browsers pass the hash through verbatim.
    expect(encoded).toMatch(/^[A-Za-z0-9+\-$]+$/);
    expect(decodePermalink(encoded)).toEqual(STATE);
    // With the leading '#' a browser hands back.
    expect(decodePermalink(`#${encoded}`)).toEqual(STATE);
  });

  it("rejects garbage, empty hashes, and non-JSON payloads", () => {
    expect(decodePermalink("")).toBeNull();
    expect(decodePermalink("#")).toBeNull();
    expect(decodePermalink("#not-a-permalink")).toBeNull();
    expect(
      decodePermalink(compressToEncodedURIComponent("not json")),
    ).toBeNull();
    expect(decodePermalink(compressToEncodedURIComponent("42"))).toBeNull();
  });

  it("refuses unknown versions instead of guessing", () => {
    const future = compressToEncodedURIComponent(
      JSON.stringify({ v: 2, context: "formula_field", formula: "1" }),
    );
    expect(decodePermalink(future)).toBeNull();
  });

  it("requires formula and context, defaults blankMode, drops bad fields", () => {
    const enc = (payload: unknown): string =>
      compressToEncodedURIComponent(JSON.stringify(payload));

    expect(decodePermalink(enc({ v: 1, context: "x" }))).toBeNull();
    expect(decodePermalink(enc({ v: 1, formula: "1" }))).toBeNull();

    const decoded = decodePermalink(
      enc({
        v: 1,
        context: "formula_field",
        formula: "A + B",
        blankMode: "bogus",
        fields: {
          A: { type: "Number", value: "1", blank: false },
          B: { type: "Number", value: 5, blank: false }, // value not a string
          C: "nonsense",
        },
      }),
    );
    expect(decoded).not.toBeNull();
    expect(decoded!.blankMode).toBe("zero");
    expect(Object.keys(decoded!.fields)).toEqual(["A"]);
  });
});
