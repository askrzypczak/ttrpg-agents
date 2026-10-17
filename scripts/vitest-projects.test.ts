import { globSync } from "node:fs";
import { matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_INCLUDE,
  UNIT_EXCLUDE,
  UNIT_INCLUDE,
} from "../vitest.globs.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const any = (file: string, globs: string[]) =>
  globs.some((g) => matchesGlob(file, g));
const inUnit = (f: string) => any(f, UNIT_INCLUDE) && !any(f, UNIT_EXCLUDE);
const inIntegration = (f: string) => any(f, INTEGRATION_INCLUDE);

const testFiles = globSync(
  ["packages/*/{src,e2e}/**/*.test.ts", "scripts/**/*.test.ts"],
  { cwd: root, exclude: (name) => name === "node_modules" || name === "dist" },
);

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
    const integration = testFiles.filter((f) =>
      f.endsWith(".integration.test.ts"),
    );
    expect(integration.length).toBeGreaterThan(0);
    for (const file of integration) {
      expect(inIntegration(file), file).toBe(true);
      expect(inUnit(file), file).toBe(false);
    }
  });

  it("keeps plain *.test.ts in the unit project", () => {
    const unit = testFiles.filter((f) => !f.endsWith(".integration.test.ts"));
    for (const file of unit) {
      expect(inUnit(file), file).toBe(true);
      expect(inIntegration(file), file).toBe(false);
    }
  });
});
