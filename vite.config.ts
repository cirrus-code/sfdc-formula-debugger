import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, client-only build — deployable to any static host. No server, no backend.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    // The bundle is a first-impression marketing surface; surface size regressions loudly.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cache chunk,
        // separate from app code and the lazy-loaded simulator/decimal.js chunk.
        manualChunks: {
          react: ["react", "react-dom", "react/jsx-runtime"],
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/lint",
            "@codemirror/autocomplete",
          ],
        },
      },
    },
  },
});
