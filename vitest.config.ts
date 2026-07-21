import { defineConfig, defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";

// Fast unit/property suite: pure functions, runs in node. Browser smoke tests
// live in `*.browser.test.tsx` and run via vitest.browser.config.ts instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    exclude: [...defaultExclude, "**/*.browser.test.{ts,tsx}"],
  },
});
