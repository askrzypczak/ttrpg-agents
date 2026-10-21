import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coverageEnabled,
  withCoverage,
  type CoveragePage,
} from "./coverage.ts";

const ORIGIN = "http://localhost:4001/";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-cov-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakePage(entries: { url: string }[]) {
  const coverage = {
    startJSCoverage: vi.fn(async () => {}),
    stopJSCoverage: vi.fn(async () => entries),
  };
  return { page: { coverage } satisfies CoveragePage, coverage };
}

describe("coverageEnabled", () => {
  it("is true only for E2E_COVERAGE=1", () => {
    expect(coverageEnabled({})).toBe(false);
    expect(coverageEnabled({ E2E_COVERAGE: "0" })).toBe(false);
    expect(coverageEnabled({ E2E_COVERAGE: "1" })).toBe(true);
  });
});

describe("withCoverage", () => {
  it("is a no-op when E2E_COVERAGE is unset: runs the test, touches nothing", async () => {
    const { page, coverage } = fakePage([{ url: `${ORIGIN}a.js` }]);
    const run = vi.fn(async () => {});
    const file = await withCoverage(
      page,
      { origin: ORIGIN, outDir: dir, env: {} },
      run,
    );
    expect(run).toHaveBeenCalledOnce();
    expect(file).toBeNull();
    expect(coverage.startJSCoverage).not.toHaveBeenCalled();
    expect(coverage.stopJSCoverage).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes only entries from the extension origin when enabled", async () => {
    const { page, coverage } = fakePage([
      { url: `${ORIGIN}assets/index.js` },
      { url: "http://127.0.0.1:4002/harness.js" },
    ]);
    const file = await withCoverage(
      page,
      { origin: ORIGIN, outDir: join(dir, "raw"), env: { E2E_COVERAGE: "1" } },
      async () => {
        expect(coverage.startJSCoverage).toHaveBeenCalled();
      },
    );
    expect(file).not.toBeNull();
    expect(JSON.parse(readFileSync(file!, "utf8"))).toEqual([
      { url: `${ORIGIN}assets/index.js` },
    ]);
  });

  it("writes nothing when no script from the origin loaded", async () => {
    const { page } = fakePage([{ url: "http://127.0.0.1:4002/x.js" }]);
    const file = await withCoverage(
      page,
      { origin: ORIGIN, outDir: dir, env: { E2E_COVERAGE: "1" } },
      async () => {},
    );
    expect(file).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("still stops coverage and rethrows when the test fails", async () => {
    const { page, coverage } = fakePage([]);
    await expect(
      withCoverage(
        page,
        { origin: ORIGIN, outDir: dir, env: { E2E_COVERAGE: "1" } },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    expect(coverage.stopJSCoverage).toHaveBeenCalledOnce();
  });
});
