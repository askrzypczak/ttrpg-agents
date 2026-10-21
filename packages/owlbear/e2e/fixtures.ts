import { test as base, expect, type Frame, type Page } from "@playwright/test";
import "./globals.d.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withCoverage } from "./coverage.js";
import { e2eDir, harnessOrigin } from "./env.js";
import { startWorkerBridge, type WorkerBridge } from "./worker-bridge.js";

// Raw V8 entries land here; scripts/coverage.ts converts them.
const COVERAGE_RAW_DIR = fileURLToPath(
  new URL("../../../reports/coverage/e2e-raw", import.meta.url),
);

const HARNESS = `${harnessOrigin()}/harness.html`;
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const STATIC_DIR = join(REPO, "packages/owlbear/dist");

// One bridge per worker process, set by the worker-scoped `bridge` fixture.
let workerBridge: WorkerBridge | undefined;

function currentBridge(): WorkerBridge {
  if (!workerBridge)
    throw new Error("worker bridge not started; use the `bridge` fixture");
  return workerBridge;
}

/** The extension URL on this worker's bridge. */
function EXTENSION(): string {
  return `${currentBridge().origin}/index.html`;
}
export const DRIVER = `${harnessOrigin()}/driver.html`;

export async function openHarness(
  page: Page,
  options: {
    role?: "gm" | "player";
    ready?: boolean;
    target?: string;
    obrOrigin?: string;
    token?: string | null;
    /** Item calls fail with this message even when the scene is ready. */
    failItems?: string;
  } = {},
): Promise<void> {
  const url = new URL(HARNESS);
  url.searchParams.set("target", options.target ?? EXTENSION());
  if (options.obrOrigin) url.searchParams.set("obrOrigin", options.obrOrigin);
  const token =
    options.token === undefined ? currentBridge().token : options.token;
  if (token) url.searchParams.set("token", token);
  if (options.failItems) url.searchParams.set("failItems", options.failItems);
  url.searchParams.set("role", options.role ?? "gm");
  url.searchParams.set("ready", options.ready === false ? "0" : "1");
  await page.goto(url.href);
}

/** Opens the harness around the test-only driver page and returns its frame. */
export async function openDriver(page: Page): Promise<Frame> {
  await openHarness(page, { target: DRIVER });
  const isDriver = (f: Frame) => new URL(f.url()).pathname === "/driver.html";
  await expect.poll(() => page.frames().some(isDriver)).toBe(true);
  const frame = page.frames().find(isDriver)!;
  await frame.waitForFunction(() => window.__e2e !== undefined);
  return frame;
}

export const test = base.extend<
  { hostErrors: { allow: boolean } },
  { bridge: WorkerBridge }
>({
  // Each worker runs its own real bridge (own port, token file and DB).
  bridge: [
    // Playwright requires the destructured first argument.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const bridge = await startWorkerBridge({
        repo: REPO,
        staticDir: STATIC_DIR,
        dir: join(e2eDir(), `worker-${workerInfo.workerIndex}`),
      });
      workerBridge = bridge;
      try {
        await use(bridge);
      } finally {
        workerBridge = undefined;
        await bridge.stop();
      }
    },
    { scope: "worker" },
  ],

  // The bridge only lets owlbear.rodeo frame the extension (frame-ancestors).
  // Swap in the harness origin for these tests, keeping the rest of the CSP.
  page: async ({ page, bridge }, use) => {
    await page.route(`${bridge.origin}/**`, async (route) => {
      const response = await route.fetch();
      const headers = response.headers();
      const csp = headers["content-security-policy"];
      if (csp)
        headers["content-security-policy"] = csp.replace(
          /frame-ancestors [^;]*/,
          `frame-ancestors ${harnessOrigin()}`,
        );
      await route.fulfill({ response, headers });
    });
    // No-op unless E2E_COVERAGE=1 (see scripts/coverage.ts).
    await withCoverage(
      page,
      { origin: `${bridge.origin}/`, outDir: COVERAGE_RAW_DIR },
      () => use(page),
    );
  },
  // Auto fixture: after every test the fake host must not have seen a
  // message it does not implement (unless the test opted in).
  hostErrors: [
    async ({ page }, use) => {
      const state = { allow: false };
      await use(state);
      if (state.allow) return;
      const errors = await page.evaluate(() => window.__host?.errors ?? []);
      expect(errors, "fake host saw unhandled messages").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
