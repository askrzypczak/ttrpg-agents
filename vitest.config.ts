import { defineConfig } from "vitest/config";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  INTEGRATION_INCLUDE,
  UNIT_EXCLUDE,
  UNIT_INCLUDE,
} from "./vitest.globs.ts";

// `npm test` runs both projects. Coverage is opt-in (--coverage), so `check`
// is not slowed; see scripts/coverage.ts.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
    },
    projects: [
      {
        test: {
          name: "unit",
          include: UNIT_INCLUDE,
          exclude: UNIT_EXCLUDE,
        },
      },
      {
        test: {
          name: "integration",
          include: INTEGRATION_INCLUDE,
        },
      },
    ],
  },
});
