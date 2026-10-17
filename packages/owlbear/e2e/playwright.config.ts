import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../test-results",
  reporter: [["list"]],
  fullyParallel: true,
  use: {
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // page.route-fulfilled documents lose their loopback address space,
        // which trips Local Network Access checks on the bridge websocket.
        launchOptions: {
          args: ["--disable-features=LocalNetworkAccessChecks"],
        },
      },
    },
  ],
  webServer: [
    {
      // The real bridge serves the real built extension (packages/owlbear/dist).
      command: "node packages/mcp/dist/bridge/cli.js",
      cwd: repo,
      env: { BRIDGE_STATIC_DIR: `${repo}packages/owlbear/dist` },
      url: "http://localhost:5199/manifest.json",
      reuseExistingServer: false,
    },
    {
      command: "node packages/owlbear/e2e/serve.ts",
      cwd: repo,
      url: "http://127.0.0.1:5200/harness.html",
      reuseExistingServer: false,
    },
  ],
});
