import { lazy, Suspense, useMemo, useState } from "react";
import { parse } from "../syntax/index.ts";
import { analyze } from "../analysis/index.ts";
import { CONTEXTS, DEFAULT_CONTEXT_ID, getContext } from "../registry/index.ts";
import { palette, font, product } from "../theme/theme.ts";
import { FormulaEditor } from "./editor/FormulaEditor.tsx";
import { offsetToLineCol } from "./util/position.ts";

// The simulator is the only route to the evaluator (and its decimal.js
// dependency), so it is code-split out of the first paint — the editor, parser,
// and diagnostics load without it. It appears once the user types a formula.
const SimulatePanel = lazy(() =>
  import("./simulate/SimulatePanel.tsx").then((m) => ({
    default: m.SimulatePanel,
  })),
);

const SAMPLE = "IF(ISBLANK(Amount), 0, Amount * 1.1)";

const SEVERITY_COLOR: Record<string, string> = {
  error: palette.danger,
  warning: palette.warning,
  info: palette.accent,
};

export function App() {
  const [source, setSource] = useState(SAMPLE);
  const [contextId, setContextId] = useState(DEFAULT_CONTEXT_ID);

  const { ast, diagnostics } = useMemo(() => {
    const parsed = parse(source);
    if (source.trim() === "") {
      return { ast: parsed.ast, diagnostics: [] as ReturnType<typeof analyze> };
    }
    const merged = [
      ...parsed.diagnostics,
      ...analyze(parsed.ast, contextId),
    ].sort((a, b) => a.span.start - b.span.start);
    return { ast: parsed.ast, diagnostics: merged };
  }, [source, contextId]);

  const context = getContext(contextId);

  return (
    <main
      style={{
        minHeight: "100%",
        background: `radial-gradient(1200px 600px at 50% -20%, ${palette.surface}, ${palette.bg})`,
        color: palette.text,
        fontFamily: font.sans,
        padding: "2rem 1.5rem",
      }}
    >
      <div style={{ maxWidth: "60rem", margin: "0 auto" }}>
        <header style={{ marginBottom: "1.5rem" }}>
          <p
            style={{
              fontFamily: font.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: palette.accent,
              marginBottom: "0.4rem",
            }}
          >
            Client-side · No backend
          </p>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, lineHeight: 1.1 }}>
            {product.name}
          </h1>
          <p style={{ marginTop: "0.4rem", color: palette.textMuted }}>
            {product.tagline}
          </p>
        </header>

        <ContextPicker contextId={contextId} onChange={setContextId} />

        <FormulaEditor
          initialDoc={SAMPLE}
          contextId={contextId}
          onChange={setSource}
        />

        {context?.notes ? (
          <p
            style={{
              marginTop: "0.6rem",
              fontSize: "0.8rem",
              color: palette.warning,
              display: "flex",
              gap: "0.4rem",
            }}
          >
            <span aria-hidden>⚠</span>
            {context.notes}
          </p>
        ) : null}

        {source.trim() === "" ? null : (
          <Suspense fallback={null}>
            <SimulatePanel
              ast={ast}
              blankToggle={context?.blankModeToggle ?? false}
            />
          </Suspense>
        )}

        <ProblemsPanel
          source={source}
          diagnostics={diagnostics}
          astKind={ast.kind}
        />
      </div>
    </main>
  );
}

interface ContextPickerProps {
  readonly contextId: string;
  readonly onChange: (id: string) => void;
}

function ContextPicker({ contextId, onChange }: ContextPickerProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        marginBottom: "0.75rem",
        fontSize: "0.85rem",
      }}
    >
      <span style={{ color: palette.textMuted }}>Context</span>
      <select
        value={contextId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: palette.surface,
          color: palette.text,
          border: `1px solid ${palette.border}`,
          borderRadius: "8px",
          padding: "0.35rem 0.6rem",
          fontFamily: font.sans,
          fontSize: "0.85rem",
        }}
      >
        {CONTEXTS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.tier === 2 ? " (unverified)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ProblemsPanelProps {
  readonly source: string;
  readonly diagnostics: ReturnType<typeof analyze>;
  readonly astKind: string;
}

function ProblemsPanel({ source, diagnostics, astKind }: ProblemsPanelProps) {
  return (
    <section
      style={{
        marginTop: "1.25rem",
        border: `1px solid ${palette.border}`,
        borderRadius: "10px",
        background: palette.surface,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.6rem 1rem",
          borderBottom: `1px solid ${palette.border}`,
          fontSize: "0.85rem",
        }}
      >
        <span style={{ fontWeight: 600 }}>Problems</span>
        <span
          style={{
            color: palette.textMuted,
            fontFamily: font.mono,
            fontSize: "0.75rem",
          }}
        >
          {diagnostics.length === 0
            ? "no problems"
            : `${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"}`}
          {" · "}
          {astKind}
        </span>
      </div>

      {diagnostics.length === 0 ? (
        <p
          style={{
            padding: "0.8rem 1rem",
            color: palette.textMuted,
            fontSize: "0.9rem",
          }}
        >
          Parses cleanly.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {diagnostics.map((d, i) => {
            const { line, col } = offsetToLineCol(source, d.span.start);
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  padding: "0.5rem 1rem",
                  borderTop: i === 0 ? "none" : `1px solid ${palette.border}`,
                  fontSize: "0.88rem",
                }}
              >
                <span
                  style={{
                    color: SEVERITY_COLOR[d.severity] ?? palette.text,
                    fontFamily: font.mono,
                    fontSize: "0.75rem",
                    whiteSpace: "nowrap",
                    paddingTop: "0.1rem",
                  }}
                >
                  {line}:{col}
                </span>
                <span>
                  {d.message}
                  <span
                    style={{
                      color: palette.textMuted,
                      fontFamily: font.mono,
                      fontSize: "0.72rem",
                      marginLeft: "0.5rem",
                    }}
                  >
                    {d.code}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
