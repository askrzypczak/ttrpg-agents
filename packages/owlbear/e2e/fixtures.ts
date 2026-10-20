import { test as base, expect, type Frame, type Page } from "@playwright/test";
import "./globals.d.ts";
import { fileURLToPath } from "node:url";
import { withCoverage } from "./coverage.js";
import { E2E_TOKEN } from "./token.js";

// Raw V8 entries land here; scripts/coverage.ts converts them.
const COVERAGE_RAW_DIR = fileURLToPath(
  new URL("../../../reports/coverage/e2e-raw", import.meta.url),
);

const HARNESS = "http://127.0.0.1:5200/harness.html";
export const EXTENSION = "http://localhost:5199/index.html";
export const DRIVER = "http://127.0.0.1:5200/driver.html";

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
  url.searchParams.set("target", options.target ?? EXTENSION);
  if (options.obrOrigin) url.searchParams.set("obrOrigin", options.obrOrigin);
  const token = options.token === undefined ? E2E_TOKEN : options.token;
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

export const test = base.extend<{ hostErrors: { allow: boolean } }>({
  // The bridge only lets owlbear.rodeo frame the extension (frame-ancestors).
  // Swap in the harness origin for these tests, keeping the rest of the CSP.
  page: async ({ page }, use) => {
    await page.route("http://localhost:5199/**", async (route) => {
      const response = await route.fetch();
      const headers = response.headers();
      const csp = headers["content-security-policy"];
      if (csp)
        headers["content-security-policy"] = csp.replace(
          /frame-ancestors [^;]*/,
          "frame-ancestors http://127.0.0.1:5200",
        );
      await route.fulfill({ response, headers });
    });
    // No-op unless E2E_COVERAGE=1 (see scripts/coverage.ts).
    await withCoverage(
      page,
      { origin: "http://localhost:5199/", outDir: COVERAGE_RAW_DIR },
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
