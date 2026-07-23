import { useMemo, useState, type ReactNode } from "react";
import type { Expr } from "../../syntax/index.ts";
import { extractFields } from "../../features/index.ts";
import type { PermalinkField } from "../../features/permalink.ts";
import {
  evaluateFormula,
  UnsupportedError,
  type BlankMode,
  type SfValue,
} from "../../engine/index.ts";
import type { SfType } from "../../registry/index.ts";
import { palette, font } from "../../theme/theme.ts";
import { buildFieldValue, FIELD_TYPES, renderResult } from "./fieldValue.ts";

interface FieldInput {
  readonly type: SfType;
  readonly value: string;
  readonly blank: boolean;
}

interface SimulatePanelProps {
  readonly ast: Expr;
  readonly blankToggle: boolean;
  /** Decoded permalink state to seed the form with (untrusted; sanitized here). */
  readonly initialSim?:
    | {
        readonly fields: Readonly<Record<string, PermalinkField>>;
        readonly blankMode: BlankMode;
      }
    | undefined;
  /** Builds the permalink for the current state and returns its URL. */
  readonly onShare?: (
    fields: Record<string, PermalinkField>,
    blankMode: BlankMode,
  ) => string;
}

/** Keep only permalink fields whose type is one the simulator offers. */
function seedInputs(
  fields: Readonly<Record<string, PermalinkField>> | undefined,
): Record<string, FieldInput> {
  const out: Record<string, FieldInput> = {};
  for (const [name, f] of Object.entries(fields ?? {})) {
    if ((FIELD_TYPES as readonly string[]).includes(f.type)) {
      out[name] = { type: f.type as SfType, value: f.value, blank: f.blank };
    }
  }
  return out;
}

export function SimulatePanel({
  ast,
  blankToggle,
  initialSim,
  onShare,
}: SimulatePanelProps) {
  const fields = useMemo(() => extractFields(ast), [ast]);
  const [inputs, setInputs] = useState<Record<string, FieldInput>>(() =>
    seedInputs(initialSim?.fields),
  );
  const [blankMode, setBlankMode] = useState<BlankMode>(
    initialSim?.blankMode ?? "zero",
  );
  // Capture the clock once so TODAY()/NOW() are stable across re-renders.
  const [now] = useState(() => ({ epochMillis: Date.now() }));

  const getInput = (name: string, inferred: SfType): FieldInput =>
    inputs[name] ?? { type: inferred, value: "", blank: false };

  const update = (
    name: string,
    inferred: SfType,
    patch: Partial<FieldInput>,
  ): void => {
    setInputs((prev) => ({
      ...prev,
      [name]: { ...getInput(name, inferred), ...patch },
    }));
  };

  const outcome = useMemo(() => {
    const map = new Map<string, SfValue>();
    for (const f of fields) {
      const input = inputs[f.name] ?? {
        type: f.inferredType,
        value: "",
        blank: false,
      };
      map.set(f.name, buildFieldValue(input.type, input.value, input.blank));
    }
    try {
      return {
        result: renderResult(
          evaluateFormula(ast, { fields: map, blankMode, now }),
        ),
      };
    } catch (e) {
      // evaluateFormula only throws UnsupportedError; anything else already
      // degraded to #Error inside it.
      if (e instanceof UnsupportedError) {
        return { unsupported: e.functionName };
      }
      return { result: "#Error!" };
    }
  }, [ast, fields, inputs, blankMode, now]);

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>Simulate</span>
        {blankToggle ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              color: palette.textMuted,
              fontSize: "0.78rem",
            }}
          >
            Blank fields as
            <select
              value={blankMode}
              onChange={(e) => setBlankMode(e.target.value as BlankMode)}
              style={selectStyle}
            >
              <option value="zero">zeroes</option>
              <option value="blank">blanks</option>
            </select>
          </label>
        ) : null}
      </div>

      {fields.length === 0 ? (
        <p
          style={{
            padding: "0.7rem 1rem",
            color: palette.textMuted,
            fontSize: "0.85rem",
          }}
        >
          No fields referenced.
        </p>
      ) : (
        <div style={{ padding: "0.4rem 0" }}>
          {fields.map((f) => {
            const input = getInput(f.name, f.inferredType);
            return (
              <div key={f.name} style={rowStyle}>
                <code
                  style={{
                    fontFamily: font.mono,
                    fontSize: "0.82rem",
                    color: palette.accent,
                    minWidth: "9rem",
                  }}
                >
                  {f.name}
                </code>
                <select
                  value={input.type}
                  onChange={(e) =>
                    update(f.name, f.inferredType, {
                      type: e.target.value as SfType,
                    })
                  }
                  style={selectStyle}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <FieldWidget
                  input={input}
                  onChange={(patch) => update(f.name, f.inferredType, patch)}
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    color: palette.textMuted,
                    fontSize: "0.75rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={input.blank}
                    onChange={(e) =>
                      update(f.name, f.inferredType, {
                        blank: e.target.checked,
                      })
                    }
                  />
                  blank
                </label>
              </div>
            );
          })}
        </div>
      )}

      <ResultBar outcome={outcome}>
        {onShare ? (
          <ShareButton onShare={() => onShare({ ...inputs }, blankMode)} />
        ) : null}
      </ResultBar>
    </section>
  );
}

/**
 * "Copy link" (DESIGN §8.5) — placed next to the result, the shareable moment.
 * The parent encodes and updates the hash; this button only copies the URL and
 * gives feedback. Clipboard access can be denied; the link is still in the
 * address bar then.
 */
function ShareButton({ onShare }: { onShare: () => string }) {
  const [label, setLabel] = useState("Copy link");

  const share = async (): Promise<void> => {
    const url = onShare();
    try {
      await navigator.clipboard.writeText(url);
      setLabel("Copied!");
    } catch {
      setLabel("Link is in the URL bar");
    }
    setTimeout(() => setLabel("Copy link"), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => {
        void share();
      }}
      title="Copy a link that restores this formula, inputs, and result"
      style={{
        marginLeft: "auto",
        background: palette.surface,
        color: palette.accent,
        border: `1px solid ${palette.border}`,
        borderRadius: "8px",
        padding: "0.25rem 0.7rem",
        fontFamily: font.sans,
        fontSize: "0.8rem",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function FieldWidget({
  input,
  onChange,
}: {
  input: FieldInput;
  onChange: (patch: Partial<FieldInput>) => void;
}) {
  if (input.blank) {
    return (
      <span style={{ flex: 1, color: palette.textMuted, fontSize: "0.8rem" }}>
        null
      </span>
    );
  }
  if (input.type === "Boolean") {
    return (
      <label
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.82rem",
        }}
      >
        <input
          type="checkbox"
          checked={input.value === "true"}
          onChange={(e) =>
            onChange({ value: e.target.checked ? "true" : "false" })
          }
        />
        {input.value === "true" ? "TRUE" : "FALSE"}
      </label>
    );
  }
  return (
    <input
      type={input.type === "Date" ? "date" : "text"}
      value={input.value}
      inputMode={
        input.type === "Number" ||
        input.type === "Currency" ||
        input.type === "Percent"
          ? "decimal"
          : undefined
      }
      placeholder={input.type === "Date" ? "" : "value"}
      onChange={(e) => onChange({ value: e.target.value })}
      style={inputStyle}
    />
  );
}

function resultLabel(outcome: {
  result?: string;
  unsupported?: string;
}): string {
  if (outcome.unsupported) {
    return `Cannot simulate: ${outcome.unsupported} depends on org state`;
  }
  if (outcome.result === "#Error!") {
    return "Salesforce would show #Error! here";
  }
  return outcome.result ?? "";
}

function resultColor(outcome: {
  result?: string;
  unsupported?: string;
}): string {
  if (outcome.unsupported) {
    return palette.textMuted;
  }
  if (outcome.result === "#Error!") {
    return palette.danger;
  }
  return palette.text;
}

function ResultBar({
  outcome,
  children,
}: {
  outcome: { result?: string; unsupported?: string };
  children?: ReactNode;
}) {
  const label = resultLabel(outcome);
  const color = resultColor(outcome);

  return (
    <div
      style={{
        borderTop: `1px solid ${palette.border}`,
        padding: "0.7rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
      }}
    >
      <span
        style={{
          color: palette.textMuted,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Result
      </span>
      <span style={{ fontFamily: font.mono, fontSize: "1rem", color }}>
        {label || "—"}
      </span>
      {children}
    </div>
  );
}

const panelStyle = {
  marginTop: "1.25rem",
  border: `1px solid ${palette.border}`,
  borderRadius: "10px",
  background: palette.surface,
  overflow: "hidden",
} as const;

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.6rem 1rem",
  borderBottom: `1px solid ${palette.border}`,
  fontSize: "0.85rem",
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.35rem 1rem",
  flexWrap: "wrap",
} as const;

const selectStyle = {
  background: palette.bg,
  color: palette.text,
  border: `1px solid ${palette.border}`,
  borderRadius: "6px",
  padding: "0.25rem 0.4rem",
  fontSize: "0.8rem",
} as const;

const inputStyle = {
  flex: 1,
  minWidth: "6rem",
  background: palette.bg,
  color: palette.text,
  border: `1px solid ${palette.border}`,
  borderRadius: "6px",
  padding: "0.3rem 0.5rem",
  fontFamily: font.mono,
  fontSize: "0.82rem",
} as const;
