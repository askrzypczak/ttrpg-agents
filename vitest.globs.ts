// Test classification (see CLAUDE.md): unit = *.test.ts, integration =
// *.integration.test.ts. Shared by vitest.config.ts and its partition test.
export const INTEGRATION_GLOB = "**/*.integration.test.ts";
export const UNIT_INCLUDE = [
  "packages/*/src/**/*.test.ts",
  "packages/*/e2e/**/*.test.ts",
  "scripts/**/*.test.ts",
];
export const UNIT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  INTEGRATION_GLOB,
];
export const INTEGRATION_INCLUDE = [
  "packages/*/src/**/*.integration.test.ts",
  "packages/*/e2e/**/*.integration.test.ts",
  "scripts/**/*.integration.test.ts",
];
export const COVERAGE_INCLUDE = ["packages/*/src/**/*.ts", "scripts/**/*.ts"];
export const COVERAGE_EXCLUDE = [
  "**/*.test.ts",
  "**/fixtures/**",
  "**/index.ts",
  "**/*.d.ts",
];
