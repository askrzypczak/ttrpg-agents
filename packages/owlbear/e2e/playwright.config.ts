import { defineConfig, devices } from "@playwright/test";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allocateRunEnv, e2eDir, harnessOrigin } from "./env.js";

// Must come first: sets the run's ports and temp dir, which the webServers,
// fixtures and (inheriting) workers all read. Each worker starts its own bridge
// (fixtures.ts), so only the harness server is a shared webServer.
await allocateRunEnv();

// Playwright re-evaluates this config in each worker; only the main process
// (no TEST_WORKER_INDEX) removes the run's temp dir when the run ends.
if (process.env.TEST_WORKER_INDEX === undefined) {
  process.on("exit", () => rmSync(e2eDir(), { recursive: true, force: true }));
}
const repo = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../test-results",
  reporter: [["list"]],
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
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
          args: [
            // When collecting coverage, also keep the cross-origin extension
            // iframe in the page's process: page.coverage cannot see OOPIFs.
            `--disable-features=LocalNetworkAccessChecks${
              process.env.E2E_COVERAGE === "1"
                ? ",IsolateOrigins,site-per-process"
                : ""
            }`,
          ],
        },
      },
    },
  ],
  webServer: [
    {
      // Inherits E2E_HARNESS_PORT from process.env (Playwright merges it in).
      command: "node packages/owlbear/e2e/serve.ts",
      cwd: repo,
      url: `${harnessOrigin()}/harness.html`,
      reuseExistingServer: false,
    },
  ],
});
