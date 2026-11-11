import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// E2E_COVERAGE=1 (set by scripts/coverage.ts and the CI e2e job) builds an
// unminified bundle with inline source maps so V8 coverage maps back to
// packages/owlbear/src.
const coverage = process.env.E2E_COVERAGE === "1";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    ...(coverage ? { minify: false, sourcemap: "inline" as const } : {}),
  },
});
