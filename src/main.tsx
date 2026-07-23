import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/jetbrains-mono";
import { applyThemeVars } from "./theme/theme.ts";
import { App } from "./ui/App.tsx";
import "./ui/global.css";

// The stylesheet resolves every color through --sfa-* custom properties;
// populate them from the theme module before anything renders.
applyThemeVars();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
