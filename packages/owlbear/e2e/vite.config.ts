import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// Builds the harness and driver pages to dist-e2e (never the production dist).
export default defineConfig({
  root: here,
  build: {
    outDir: fileURLToPath(new URL("../dist-e2e", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        harness: fileURLToPath(new URL("./harness.html", import.meta.url)),
        driver: fileURLToPath(new URL("./driver.html", import.meta.url)),
      },
    },
  },
});
