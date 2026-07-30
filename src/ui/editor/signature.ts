import type { FunctionSpec, ParamSpec } from "../../registry/index.ts";

function formatParam(p: ParamSpec): string {
  if (p.variadic) {
    return `${p.name}…`;
  }
  if (p.optional) {
    return `[${p.name}]`;
  }
  return p.name;
}

/** `IF` → `IF(logical_test, value_if_true, value_if_false)`. */
export function signature(spec: FunctionSpec): string {
  return `${spec.name}(${spec.params.map(formatParam).join(", ")})`;
}

/**
 * `IF` → `IF(${logical_test}, ${value_if_true}, ${value_if_false})` — a
 * CodeMirror snippet template for inserting a call skeleton. Fields cover the
 * minimal valid call (optional params dropped, a variadic tail once), so the
 * insertion lands with the first placeholder selected and Tab walking the rest.
 */
export function insertionTemplate(spec: FunctionSpec): string {
  const fields = spec.params
    .filter((p) => !p.optional)
    .map((p) => `\${${p.name}}`);
  return `${spec.name}(${fields.join(", ")})`;
}
