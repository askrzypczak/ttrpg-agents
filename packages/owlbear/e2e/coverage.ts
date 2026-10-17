import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const COVERAGE_ENV = "E2E_COVERAGE";

/** The subset of Playwright's page.coverage this module needs. */
export interface CoveragePage {
  coverage: {
    startJSCoverage(options?: { resetOnNavigation?: boolean }): Promise<void>;
    stopJSCoverage(): Promise<{ url: string }[]>;
  };
}

export interface CoverageOptions {
  /** Only scripts whose url starts with this origin are kept. */
  origin: string;
  /** Raw V8 entries are written here, one JSON file per test. */
  outDir: string;
  env?: Record<string, string | undefined>;
}

export function coverageEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[COVERAGE_ENV] === "1";
}

/**
 * Wraps one test with V8 JS coverage. A no-op unless E2E_COVERAGE=1, so normal
 * e2e runs pay nothing. Returns the written file, or null when disabled or
 * nothing from `origin` was loaded.
 */
export async function withCoverage(
  page: CoveragePage,
  options: CoverageOptions,
  run: () => Promise<void>,
): Promise<string | null> {
  if (!coverageEnabled(options.env)) {
    await run();
    return null;
  }
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  let written: string | null = null;
  try {
    await run();
  } finally {
    const entries = (await page.coverage.stopJSCoverage()).filter((e) =>
      e.url.startsWith(options.origin),
    );
    if (entries.length > 0) {
      mkdirSync(options.outDir, { recursive: true });
      written = join(options.outDir, `${randomUUID()}.json`);
      writeFileSync(written, JSON.stringify(entries));
    }
  }
  return written;
}
