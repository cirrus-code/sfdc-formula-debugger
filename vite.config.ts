import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, client-only build — deployable to any static host. No server, no backend.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    // The bundle is a first-impression marketing surface; surface size regressions loudly.
    chunkSizeWarningLimit: 600,
  },
});
