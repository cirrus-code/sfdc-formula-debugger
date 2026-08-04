export const linter = {
  hardcodedId: (value: string) =>
    `"${value}" looks like a hardcoded record ID. IDs are org-specific ` +
    "(sandbox and production differ) — look the record up by name, or keep " +
    "the ID in a Custom Label or Custom Setting.",
  deepIfNesting: (depth: number) =>
    `IF calls nested ${depth} levels deep. CASE(), or splitting the ` +
    "logic into helper formula fields, is usually easier to read and " +
    "maintain.",
  preferIspickval: (path: string, literal: string) =>
    `If ${path} is a picklist, compare it with ISPICKVAL(${path}, ` +
    `${literal}) instead of converting with TEXT().`,
  invisibleInString: (hex: string, name: string | null, count: number) =>
    (count === 1
      ? `This text contains an invisible character U+${hex}`
      : `This text contains ${count} invisible characters U+${hex}`) +
    (name === null ? "" : ` (${name})`) +
    ". It compiles, but it is part of the text's value — comparisons " +
    "against text that looks identical can fail.",
  charLimit: (length: number, contextLabel: string, charLimit: number) =>
    `Formula is ${length} characters; the ${contextLabel} limit is ` +
    `${charLimit}. Salesforce actually enforces a compiled-size ` +
    "limit, which differs from source length and cannot be computed " +
    "exactly outside Salesforce.",
};
