import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/fonts.ts";
import { t } from "./i18n/index.ts";
import { applyThemeVars } from "./theme/theme.ts";
import { App } from "./ui/App.tsx";
import "./ui/global.css";

// The stylesheet resolves every color through --sfa-* custom properties;
// populate them from the theme module before anything renders.
applyThemeVars();

// index.html carries the static English title for pre-JS rendering; the
// catalog re-asserts it here so a boot-time locale swap covers the tab title.
document.title = t().copy.pageTitle;

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
