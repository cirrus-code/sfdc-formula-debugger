/**
 * analysis/ — type checker, context validator, diagnostics.
 *
 * Walks the AST against the registry for type agreement, arity, context
 * availability, and return-type requirements. Unknown unifies with anything to
 * avoid cascading noise. Also infers field types to drive the simulation form.
 *
 * May depend on: engine/, registry/, syntax/.
 */
export {};
