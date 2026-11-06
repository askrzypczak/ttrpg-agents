import { globSync } from "node:fs";
import { basename, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  INTEGRATION_INCLUDE,
  UNIT_EXCLUDE,
  UNIT_INCLUDE,
} from "../vitest.globs.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const any = (file: string, globs: string[]) =>
  globs.some((g) => matchesGlob(file, g));
const inUnit = (f: string) => any(f, UNIT_INCLUDE) && !any(f, UNIT_EXCLUDE);
const inIntegration = (f: string) => any(f, INTEGRATION_INCLUDE);
const inCoverage = (f: string) =>
  any(f, COVERAGE_INCLUDE) && !any(f, COVERAGE_EXCLUDE);
const isIntegrationTest = (f: string) =>
  f.endsWith(".integration.test.ts") || f.endsWith(".integration.test.tsx");
const isTest = (f: string) => f.endsWith(".test.ts") || f.endsWith(".test.tsx");

// Every test file in the repo, whatever its folder, so a test added anywhere
// must still fit exactly one project. Directories are skipped by name at any
// depth:
//   node_modules, dist, dist-e2e, reports: installed packages and build or
//     report output, not source.
//   .git: git metadata.
//   .claude: agent worktrees (.claude/worktrees/<name>) are full copies of the
//     repo whose paths match no project glob, so they would fail the check.
// globSync passes each entry's path relative to `root`, so match the basename.
// globSync also skips dot-directories by default, so .claude and .git are
// listed as belt and braces.
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-e2e",
  ".claude",
  "reports",
  ".git",
]);

const testFiles = globSync("**/*.{test,spec}.{ts,tsx}", {
  cwd: root,
  exclude: (entry) => SKIPPED_DIRS.has(basename(entry)),
});

describe("vitest unit/integration projects", () => {
  it("discovers the existing tests", () => {
    expect(testFiles.length).toBeGreaterThan(10);
  });

  it("runs every test file in exactly one project", () => {
    for (const file of testFiles) {
      const count = Number(inUnit(file)) + Number(inIntegration(file));
      expect(count, file).toBe(1);
    }
  });

  it("puts *.integration.test.ts only in the integration project", () => {
    const integration = testFiles.filter(isIntegrationTest);
    expect(integration.length).toBeGreaterThan(0);
    for (const file of integration) {
      expect(inIntegration(file), file).toBe(true);
      expect(inUnit(file), file).toBe(false);
    }
  });

  it("keeps plain *.test.ts in the unit project", () => {
    const unit = testFiles.filter((f) => isTest(f) && !isIntegrationTest(f));
    for (const file of unit) {
      expect(inUnit(file), file).toBe(true);
      expect(inIntegration(file), file).toBe(false);
    }
  });

  it("puts *.test.tsx in the unit project and *.integration.test.tsx only in the integration project", () => {
    const unit = "packages/owlbear/src/x.test.tsx";
    expect(inUnit(unit)).toBe(true);
    expect(inIntegration(unit)).toBe(false);

    const integration = "packages/owlbear/src/x.integration.test.tsx";
    expect(inIntegration(integration)).toBe(true);
    expect(inUnit(integration)).toBe(false);
  });

  it("counts .tsx source in coverage and leaves *.test.tsx out", () => {
    expect(inCoverage("packages/owlbear/src/x.tsx")).toBe(true);
    expect(inCoverage("packages/owlbear/src/x.test.tsx")).toBe(false);
    expect(inCoverage("packages/owlbear/src/x.integration.test.tsx")).toBe(
      false,
    );
  });
});
