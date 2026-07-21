import { describe, expect, it } from "vitest";
import { parse } from "../syntax/index.ts";
import { extractFields } from "./field-extraction.ts";

function fields(source: string) {
  return extractFields(parse(source).ast);
}

describe("field extraction", () => {
  it("collects unique fields", () => {
    const f = fields("Amount + Amount + Tax");
    expect(f.map((x) => x.name).sort()).toEqual(["Amount", "Tax"]);
  });

  it("keeps dotted paths as one flat field", () => {
    expect(fields("Account.Owner.Name")[0]!.name).toBe("Account.Owner.Name");
  });

  it("flags globals", () => {
    expect(fields("$User.Id")[0]).toMatchObject({ name: "$User.Id", isGlobal: true });
  });

  it("infers Number from arithmetic", () => {
    expect(fields("Amount * 2")[0]!.inferredType).toBe("Number");
  });

  it("infers a type from function argument position", () => {
    // LEN expects Text.
    expect(fields("LEN(Name)")[0]!.inferredType).toBe("Text");
    // YEAR expects Date.
    expect(fields("YEAR(Closed)")[0]!.inferredType).toBe("Date");
  });

  it("infers Boolean from a logical context", () => {
    expect(fields("AND(Flag, TRUE)")[0]!.inferredType).toBe("Boolean");
  });

  it("defaults to Text when there is no signal", () => {
    expect(fields("Foo = Bar")[0]!.inferredType).toBe("Text");
  });
});
