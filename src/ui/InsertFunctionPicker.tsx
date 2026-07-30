import { useMemo } from "react";
import { FUNCTIONS } from "../registry/index.ts";
import { t } from "../i18n/index.ts";
import { insertionTemplate, signature } from "./editor/signature.ts";

interface InsertFunctionPickerProps {
  readonly contextId: string;
  readonly onInsert: (template: string) => void;
}

/**
 * Salesforce-style "Insert Function" picker: lists the functions the registry
 * allows in the active context and inserts a call skeleton at the cursor. A
 * native select used as a menu — its controlled value is pinned to the
 * placeholder option, so it snaps back after every insertion.
 */
export function InsertFunctionPicker({
  contextId,
  onInsert,
}: InsertFunctionPickerProps) {
  // The registry orders functions by category; a picker scanned by name wants
  // them alphabetical (and gets the native select's type-to-jump for free).
  const available = useMemo(
    () =>
      FUNCTIONS.filter(
        (f) => f.contexts === "all" || f.contexts.includes(contextId),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [contextId],
  );

  return (
    <select
      className="select"
      style={{ minWidth: 0 }}
      value=""
      aria-label={t().ui.toolbar.insertFunction}
      title={t().ui.toolbar.insertFunctionTitle}
      onChange={(e) => {
        const spec = available.find((f) => f.name === e.target.value);
        if (spec) {
          onInsert(insertionTemplate(spec));
        }
      }}
    >
      <option value="" disabled>
        {t().ui.toolbar.insertFunction}
      </option>
      {available.map((f) => (
        <option key={f.name} value={f.name} title={signature(f)}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
