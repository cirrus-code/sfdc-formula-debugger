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
    expect(fields("$User.Id")[0]).toMatchObject({
      name: "$User.Id",
      isGlobal: true,
    });
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

  it("infers Boolean from infix && operands, not Text", () => {
    const f = fields("A__c && B__c");
    expect(f.find((x) => x.name === "A__c")!.inferredType).toBe("Boolean");
    expect(f.find((x) => x.name === "B__c")!.inferredType).toBe("Boolean");
  });

  it("infers Boolean from infix || operands, not Text", () => {
    const f = fields("A__c || B__c");
    expect(f.find((x) => x.name === "A__c")!.inferredType).toBe("Boolean");
    expect(f.find((x) => x.name === "B__c")!.inferredType).toBe("Boolean");
  });

  it("infers Date from an ordering comparison against TODAY()", () => {
    expect(fields("CloseDate > TODAY()")[0]!.inferredType).toBe("Date");
  });

  it("infers Text from an ordering comparison against a string literal", () => {
    expect(fields('Name < "M"')[0]!.inferredType).toBe("Text");
  });

  it("still infers Number from an ordering comparison against a number literal", () => {
    expect(fields("Amount > 100")[0]!.inferredType).toBe("Number");
  });

  it("defaults both sides of an ordering comparison when neither carries a signal", () => {
    const f = fields("X__c > Y__c");
    expect(f.find((x) => x.name === "X__c")!.inferredType).toBe("Text");
    expect(f.find((x) => x.name === "Y__c")!.inferredType).toBe("Text");
  });
});
