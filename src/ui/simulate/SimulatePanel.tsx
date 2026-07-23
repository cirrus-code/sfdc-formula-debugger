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
import { palette, syntax, font } from "../../theme/theme.ts";
import { Panel } from "../Panel.tsx";
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
    <Panel
      label="Simulate"
      right={
        blankToggle ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              color: palette.textMuted,
              fontSize: "0.75rem",
            }}
          >
            Blank fields as
            <select
              className="select"
              value={blankMode}
              onChange={(e) => setBlankMode(e.target.value as BlankMode)}
            >
              <option value="zero">zeroes</option>
              <option value="blank">blanks</option>
            </select>
          </label>
        ) : undefined
      }
    >
      {fields.length === 0 ? (
        <p
          style={{
            padding: "0.7rem 1rem",
            color: palette.textMuted,
            fontSize: "0.82rem",
          }}
        >
          No fields referenced.
        </p>
      ) : (
        <div style={{ padding: "0.4rem 0" }}>
          {fields.map((f) => {
            const input = getInput(f.name, f.inferredType);
            return (
              <div key={f.name} className="row-hover" style={rowStyle}>
                <code
                  style={{
                    fontSize: "0.82rem",
                    color: syntax.field,
                    minWidth: "9rem",
                  }}
                >
                  {f.name}
                </code>
                <select
                  className="select"
                  value={input.type}
                  onChange={(e) =>
                    update(f.name, f.inferredType, {
                      type: e.target.value as SfType,
                    })
                  }
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
                    fontSize: "0.72rem",
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
    </Panel>
  );
}

/**
 * "Copy link" (DESIGN §8.5) — placed next to the result, the shareable moment,
 * and styled as the page's single filled button: this is the growth mechanism.
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
      className="btn btn--primary"
      onClick={() => {
        void share();
      }}
      title="Copy a link that restores this formula, inputs, and result"
      style={{ marginLeft: "auto" }}
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

function ResultBar({
  outcome,
  children,
}: {
  outcome: { result?: string; unsupported?: string };
  children?: ReactNode;
}) {
  const label = resultLabel(outcome);
  let led = "led--ok";
  let color: string = palette.text;
  if (outcome.unsupported) {
    led = "led--warn";
    color = palette.textMuted;
  } else if (outcome.result === "#Error!") {
    led = "led--err";
    color = palette.danger;
  }

  return (
    <div
      style={{
        borderTop: `1px solid ${palette.border}`,
        padding: "0.7rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.65rem",
      }}
    >
      <span className="microcopy">Result</span>
      <span className={`led ${led}`} aria-hidden />
      {/* Keyed so a changed result re-triggers the readout-in flash. */}
      <span
        key={label}
        className="readout"
        style={{
          fontFamily: font.mono,
          fontSize: "1rem",
          fontWeight: 600,
          color,
          overflowWrap: "anywhere",
        }}
      >
        {label || "—"}
      </span>
      {children}
    </div>
  );
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.4rem 1rem",
  flexWrap: "wrap",
} as const;

const inputStyle = {
  flex: 1,
  minWidth: "6rem",
  background: palette.well,
  color: palette.text,
  border: `1px solid ${palette.border}`,
  borderRadius: "8px",
  padding: "0.3rem 0.55rem",
  fontFamily: font.mono,
  fontSize: "0.82rem",
} as const;
