// Test classification (see CLAUDE.md): unit = *.test.ts(x), integration =
// *.integration.test.ts(x). Shared by vitest.config.ts and its partition test.
export const INTEGRATION_GLOB = "**/*.integration.test.{ts,tsx}";
export const UNIT_INCLUDE = [
  "packages/*/src/**/*.test.{ts,tsx}",
  "packages/*/e2e/**/*.test.{ts,tsx}",
  "scripts/**/*.test.{ts,tsx}",
];
export const UNIT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  INTEGRATION_GLOB,
];
export const INTEGRATION_INCLUDE = [
  "packages/*/src/**/*.integration.test.{ts,tsx}",
  "packages/*/e2e/**/*.integration.test.{ts,tsx}",
  "scripts/**/*.integration.test.{ts,tsx}",
];
export const COVERAGE_INCLUDE = [
  "packages/*/src/**/*.{ts,tsx}",
  "scripts/**/*.ts",
];
export const COVERAGE_EXCLUDE = [
  "**/*.test.{ts,tsx}",
  "**/fixtures/**",
  "packages/engine/src/testing/**",
  "**/index.ts",
  "**/*.d.ts",
];
