import { defineConfig, devices } from "@playwright/test";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { e2eDbPath, seedE2eDatabase } from "./db.js";
import {
  allocateRunEnv,
  bridgeOrigin,
  bridgePort,
  e2eDir,
  harnessOrigin,
} from "./env.js";
import { writeE2eTokenFile } from "./token.js";

// Must come first: sets the run's ports and temp dir, which the webServers,
// fixtures and (inheriting) workers all read.
await allocateRunEnv();

const tokenFile = writeE2eTokenFile();
// Playwright re-evaluates this config in each worker; only the main process
// (no TEST_WORKER_INDEX) may recreate the DB the running bridge is using, and
// it alone removes the run's temp dir when the run ends.
if (process.env.TEST_WORKER_INDEX === undefined) {
  seedE2eDatabase();
  process.on("exit", () => rmSync(e2eDir(), { recursive: true, force: true }));
}
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
      // The real bridge serves the real built extension (packages/owlbear/dist).
      command: "node packages/mcp/dist/bridge/cli.js",
      cwd: repo,
      env: {
        BRIDGE_PORT: String(bridgePort()),
        BRIDGE_STATIC_DIR: `${repo}packages/owlbear/dist`,
        BRIDGE_TOKEN_FILE: tokenFile,
        TTRPG_AGENTS_DB: e2eDbPath(),
      },
      url: `${bridgeOrigin()}/manifest.json`,
      reuseExistingServer: false,
    },
    {
      // Inherits E2E_HARNESS_PORT from process.env (Playwright merges it in).
      command: "node packages/owlbear/e2e/serve.ts",
      cwd: repo,
      url: `${harnessOrigin()}/harness.html`,
      reuseExistingServer: false,
    },
  ],
});
