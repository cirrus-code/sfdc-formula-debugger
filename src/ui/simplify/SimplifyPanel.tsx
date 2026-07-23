import { useMemo } from "react";
import { simplifySource } from "../../features/simplifier.ts";
import { font, palette } from "../../theme/theme.ts";

interface SimplifyPanelProps {
  readonly source: string;
  readonly onApply: (text: string) => void;
}

/**
 * Boolean-simplifier panel (DESIGN §8.2/§9): the step log rendered as a
 * before → after transformation, unsafe rewrites as caveated suggestions, and
 * an Apply button that writes the simplified formula into the editor. Hidden
 * when there is nothing to say.
 */
export function SimplifyPanel({ source, onApply }: SimplifyPanelProps) {
  const result = useMemo(() => simplifySource(source), [source]);
  if (!result || (!result.changed && result.suggestions.length === 0)) {
    return null;
  }

  // The simplified output is comment-free; refuse to silently destroy the
  // user's comments on Apply (the spirit of rule 5).
  const hasComments = source.includes("/*");

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
        <span style={{ fontWeight: 600 }}>Simplify</span>
        {result.changed ? (
          <button
            type="button"
            onClick={() => onApply(result.formatted)}
            disabled={hasComments}
            title={
              hasComments
                ? "Applying would remove the formula's comments"
                : "Replace the formula with the simplified version"
            }
            style={{
              background: palette.surface,
              color: hasComments ? palette.textMuted : palette.text,
              border: `1px solid ${palette.border}`,
              borderRadius: "8px",
              padding: "0.25rem 0.7rem",
              fontFamily: font.sans,
              fontSize: "0.8rem",
              cursor: hasComments ? "not-allowed" : "pointer",
            }}
          >
            Apply
          </button>
        ) : null}
      </div>

      {result.changed ? (
        <div style={{ padding: "0.8rem 1rem" }}>
          <pre
            style={{
              margin: 0,
              fontFamily: font.mono,
              fontSize: "0.85rem",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {result.formatted}
          </pre>
          <ol
            style={{
              margin: "0.75rem 0 0",
              paddingLeft: "1.4rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
            }}
          >
            {result.steps.map((step, i) => (
              <li key={i} style={{ fontSize: "0.85rem" }}>
                {step.title}
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: "0.78rem",
                    color: palette.textMuted,
                    overflowWrap: "anywhere",
                  }}
                >
                  {step.detail}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.suggestions.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: "0.6rem 1rem 0.8rem",
            borderTop: result.changed ? `1px solid ${palette.border}` : "none",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          {result.suggestions.map((sugg, i) => (
            <li
              key={i}
              style={{
                fontSize: "0.85rem",
                color: palette.textMuted,
                display: "flex",
                gap: "0.5rem",
              }}
            >
              <span aria-hidden style={{ color: palette.warning }}>
                ⚠
              </span>
              <span style={{ overflowWrap: "anywhere" }}>{sugg.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
