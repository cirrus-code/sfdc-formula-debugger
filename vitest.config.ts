import { defineConfig, defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";

// Fast unit/property suite: pure functions, runs in node. Browser smoke tests
// live in `*.browser.test.tsx` and run via vitest.browser.config.ts instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // direnv symlinks the flake inputs into .direnv, and one of them is a store
    // snapshot of this repo, so the default include glob collected every suite a
    // second time from frozen sources that drift as the working tree moves.
    exclude: [...defaultExclude, "**/.direnv/**", "**/*.browser.test.{ts,tsx}"],
  },
});
