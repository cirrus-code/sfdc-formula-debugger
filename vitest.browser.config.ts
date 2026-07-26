import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

/**
 * Browser smoke tests (real Chromium via Playwright). The flake devShell sets
 * PLAYWRIGHT_BROWSERS_PATH to the nixpkgs playwright-browsers bundle, so
 * Playwright's normal registry lookup finds a browser that runs on NixOS too.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: ["--no-sandbox"],
        },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
