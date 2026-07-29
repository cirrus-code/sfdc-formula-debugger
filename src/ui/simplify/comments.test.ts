import { describe, expect, it } from "vitest";
import { hasComments } from "./comments.ts";

describe("hasComments", () => {
  it("is false for a formula with no comments", () => {
    expect(hasComments("Amount__c * 2")).toBe(false);
  });

  it("is true for a formula with a block comment", () => {
    expect(hasComments("/* discount */ Amount__c * 2")).toBe(true);
  });

  it("is true for a trailing comment", () => {
    expect(hasComments("Amount__c * 2 /* discount */")).toBe(true);
  });

  it("is false when '/*' only appears inside a string literal", () => {
    expect(hasComments('IF(Status__c = "N/A", "n/*a*/", "")')).toBe(false);
  });

  it("is true when a real comment sits alongside a string containing '/*'", () => {
    expect(hasComments('/* note */ IF(Status__c = "N/A", "n/*a*/", "")')).toBe(
      true,
    );
  });

  it("is true for a comment buried inside a function call, before the first argument", () => {
    expect(hasComments("IF(/* cond */ TRUE, 1, 2)")).toBe(true);
  });
});
