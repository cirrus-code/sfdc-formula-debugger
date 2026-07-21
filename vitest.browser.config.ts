import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

/**
 * Browser smoke tests (real Chromium via Playwright). To keep these runnable
 * under Nix, we point Playwright at the nixpkgs-provided Chromium via
 * CHROMIUM_BIN (set in the flake devShell) instead of letting the npm package
 * download a prebuilt browser that won't run on NixOS.
 */
const executablePath = process.env.CHROMIUM_BIN;

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ["--no-sandbox"],
        },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
