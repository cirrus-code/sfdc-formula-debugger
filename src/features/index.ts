/**
 * features/ — simplifier, formatter, linter, field extraction.
 *
 * Pure functions over the AST. Formatter is idempotent and semantics-preserving
 * (comments survive). Simplifier rewrites must be equivalence-preserving under
 * Salesforce blank semantics, not just classical boolean algebra.
 *
 * May depend on: analysis/, engine/, registry/, syntax/.
 */
export { extractFields, type ExtractedField } from "./field-extraction.ts";
