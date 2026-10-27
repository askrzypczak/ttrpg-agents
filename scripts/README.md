# scripts

Root-level repo tooling. Ticket automation (agent dispatch, label setup, close-time label cleanup) moved to the `askrzypczak/claude-workflow` repo.

- `coverage.ts`: `npm run coverage`. Unit, integration and e2e coverage plus a merged total. Informational only; reports land in `reports/coverage/<kind>`. Also writes `total/coverage-final.json` and `coverage-summary.json` (baseline artifact), the latter only when unit, integration and e2e were all collected.
  - CI runs each suite once: the `check` job runs `npm run coverage -- unit integration` as its test step (vitest runs here get a 30s test timeout) and uploads the two `coverage-final.json` files (artifact `vitest-coverage`), and the `e2e` job collects the raw e2e data (`E2E_COVERAGE=1`, artifact `e2e-raw-coverage`).
  - The `coverage` job points `COVERAGE_VITEST_DIR` and `COVERAGE_E2E_RAW_DIR` at those artifacts so no suite is re-run; a separate `comment` job holds the only `pull-requests: write` and posts `summary.md` as a sticky comment (hidden marker, edited in place).
  - Optional env: `COVERAGE_BASE_REF` (e.g. `origin/main`; enables patch coverage from `git diff -U0 <ref>...HEAD`) and `COVERAGE_BASELINE` (path to a `coverage-summary.json` from main; enables the delta). Both unset locally means "no baseline" / "no coverable lines changed".
  - A failing unit, integration or e2e test run (e2e only when the script runs the suite itself) makes it exit 1 after writing the reports and `summary.md`; missing data and baseline or patch errors never fail the run.
- `coverage-lib.ts`: pure helpers for `coverage.ts` (Istanbul merge, per-kind table, diff parsing, patch coverage, delta and comment formatting). Unit-tested in `coverage-lib.test.ts`.
- `vitest-projects.test.ts`: checks that every test file belongs to exactly one vitest project (see `vitest.globs.ts`).
- `docs.test.ts`: fails on a prose block over 1,000 characters in the root README, this file, `docs/*.md` or a package README, so a section is split instead of growing (see `docs/reviewing.md`, section 6).
