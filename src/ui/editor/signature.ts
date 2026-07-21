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
