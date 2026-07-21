import { theme } from "../theme/theme.ts";

const { palette, font, product } = theme;

/**
 * Scaffold landing page: proves the toolchain and static build work end to end.
 * The real single-page layout (context picker → CodeMirror editor → Simulate /
 * Problems / Simplify / Format panels) lands as the `ui/` layer is built out.
 */
export function App() {
  return (
    <main
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: `radial-gradient(1200px 600px at 50% -10%, ${palette.surface}, ${palette.bg})`,
        color: palette.text,
        fontFamily: font.sans,
      }}
    >
      <div style={{ maxWidth: "36rem", textAlign: "center" }}>
        <p
          style={{
            fontFamily: font.mono,
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: palette.accent,
            marginBottom: "1rem",
          }}
        >
          Client-side · No backend
        </p>
        <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, fontWeight: 700 }}>
          {product.name}
        </h1>
        <p
          style={{
            marginTop: "1rem",
            fontSize: "1.1rem",
            color: palette.textMuted,
          }}
        >
          {product.tagline}
        </p>
        <code
          style={{
            display: "inline-block",
            marginTop: "2rem",
            padding: "0.6rem 1rem",
            borderRadius: "0.5rem",
            border: `1px solid ${palette.border}`,
            background: palette.surface,
            fontFamily: font.mono,
            fontSize: "0.9rem",
            color: palette.textMuted,
          }}
        >
          IF(ISBLANK(Amount), 0, Amount * 1.1)
        </code>
      </div>
    </main>
  );
}
