import { useMemo, useState } from "react";
import { parse } from "../syntax/index.ts";
import { palette, font, product } from "../theme/theme.ts";
import { FormulaEditor } from "./editor/FormulaEditor.tsx";
import { offsetToLineCol } from "./util/position.ts";

const SAMPLE = "IF(ISBLANK(Amount), 0, Amount * 1.1)";

const SEVERITY_COLOR: Record<string, string> = {
  error: palette.danger,
  warning: palette.warning,
  info: palette.accent,
};

export function App() {
  const [source, setSource] = useState(SAMPLE);
  const result = useMemo(() => parse(source), [source]);
  const diagnostics = source.trim() === "" ? [] : result.diagnostics;

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
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, lineHeight: 1.1 }}>{product.name}</h1>
          <p style={{ marginTop: "0.4rem", color: palette.textMuted }}>{product.tagline}</p>
        </header>

        <FormulaEditor initialDoc={SAMPLE} onChange={setSource} />

        <ProblemsPanel source={source} diagnostics={diagnostics} astKind={result.ast.kind} />
      </div>
    </main>
  );
}

interface ProblemsPanelProps {
  readonly source: string;
  readonly diagnostics: ReturnType<typeof parse>["diagnostics"];
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
        <span style={{ color: palette.textMuted, fontFamily: font.mono, fontSize: "0.75rem" }}>
          {diagnostics.length === 0 ? "no problems" : `${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"}`}
          {" · "}
          {astKind}
        </span>
      </div>

      {diagnostics.length === 0 ? (
        <p style={{ padding: "0.8rem 1rem", color: palette.textMuted, fontSize: "0.9rem" }}>
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
                  <span style={{ color: palette.textMuted, fontFamily: font.mono, fontSize: "0.72rem", marginLeft: "0.5rem" }}>
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
