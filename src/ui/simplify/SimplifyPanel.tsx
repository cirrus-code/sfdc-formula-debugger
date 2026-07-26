import { useMemo } from "react";
import { simplifySource } from "../../features/simplifier.ts";
import { t } from "../../i18n/index.ts";
import { palette } from "../../theme/theme.ts";
import { Panel } from "../Panel.tsx";

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
  // user's comments on Apply (comments must survive every transformation).
  const hasComments = source.includes("/*");

  return (
    <Panel
      label={t().ui.simplify.label}
      right={
        result.changed ? (
          <button
            type="button"
            className="btn"
            onClick={() => onApply(result.formatted)}
            disabled={hasComments}
            title={
              hasComments
                ? t().ui.simplify.applyWouldRemoveComments
                : t().ui.simplify.applyReplaces
            }
          >
            {t().ui.simplify.apply}
          </button>
        ) : undefined
      }
    >
      {result.changed ? (
        <div style={{ padding: "0.8rem 1rem" }}>
          <pre
            style={{
              margin: 0,
              background: palette.well,
              border: `1px solid ${palette.border}`,
              borderRadius: "8px",
              padding: "0.6rem 0.8rem",
              fontSize: "0.85rem",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {result.formatted}
          </pre>
          <ol
            style={{
              listStyle: "none",
              margin: "0.85rem 0 0",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {result.steps.map((step, i) => (
              <li
                key={i}
                style={{ display: "flex", gap: "0.7rem", fontSize: "0.84rem" }}
              >
                <span
                  aria-hidden
                  style={{
                    color: palette.accent,
                    fontSize: "0.72rem",
                    paddingTop: "0.15rem",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  {step.title}
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: palette.textMuted,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {step.detail}
                  </div>
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
                fontSize: "0.82rem",
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
    </Panel>
  );
}
