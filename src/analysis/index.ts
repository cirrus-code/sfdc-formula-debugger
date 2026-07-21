/**
 * analysis/ — type checker, context validator, diagnostics.
 *
 * Walks the AST against the registry for type agreement, arity, context
 * availability, and return-type requirements. Unknown unifies with anything to
 * avoid cascading noise. Also infers field types to drive the simulation form.
 *
 * May depend on: engine/, registry/, syntax/.
 */
import { parse, type Diagnostic } from "../syntax/index.ts";
import { analyze } from "./checker.ts";

export { analyze } from "./checker.ts";
export * from "./types.ts";

/**
 * Run the full diagnostic pipeline — parse (syntax + recovery) then analyze
 * (types, arity, availability, return type) — and return all findings in source
 * order. The single entry point for both the editor linter and the UI panel.
 */
export function diagnose(
  source: string,
  contextId: string,
): readonly Diagnostic[] {
  const { ast, diagnostics } = parse(source);
  return [...diagnostics, ...analyze(ast, contextId)].sort(
    (a, b) => a.span.start - b.span.start,
  );
}
