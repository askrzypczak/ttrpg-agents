# bug: coverage job's unit run times out in eslint-policy.test.ts and the job stays green

Issue: [#248](https://github.com/askrzypczak/ttrpg-agents/issues/248).

## 248.1 `npm run coverage` exits 1 when a unit, integration or (locally run) e2e test run fails

- Decided by: maintainer, 2026-10-25, plan gate.
- Context: `scripts/coverage.ts` only logged `coverage: unit tests failed` and exited 0, so the CI `coverage` job stayed green while a unit test timed out on every run, and the PR comment and main baseline silently lost unit coverage.
- Options:
  - Chosen: a failing test run sets exit code 1, after the reports and `summary.md` are written, so the PR comment still posts; e2e counts only when the script runs the suite itself (local runs, no `COVERAGE_E2E_RAW_DIR`). Missing data, baseline and patch problems still never fail the run.
  - Unit and integration only (the ticket's wording; the spec audit proposed it): in CI the coverage job reuses raw e2e data and the required `e2e` job already gates e2e failures, so e2e matters only locally; lost to consistency for local runs.
  - Keep exiting 0 and rely on the log line: that is how the timeout stayed hidden since 2026-10-24.
- Where: `exitCode` in `scripts/coverage-lib.ts`; `vitestKind`, `e2eKind` and `main` in `scripts/coverage.ts`; `scripts/README.md`.
- Revisit if: the coverage job should stay green on test failures again (for example if it becomes a required check and a red test there would duplicate `check`).
- Status: active

## 248.2 The exit decision is proven by a pure helper's unit tests plus one recorded manual run

- Decided by: maintainer, 2026-10-25, plan gate.
- Context: The ticket asks for "a test showing it". `coverage.ts` spawns vitest and wipes `reports/coverage`, so an end-to-end test would run vitest inside vitest.
- Options:
  - Chosen: `exitCode(failedRuns)` in `scripts/coverage-lib.ts` with two unit tests; the wiring is shown once by hand (a temporarily failing unit test, exit status recorded in the PR).
  - An integration test spawning the script with test-only env hooks (a stand-in for `npx vitest`, a separate output dir): proves the real wiring, but adds config only a test uses and a slower test to `npm run check`.
- Where: `exitCode` in `scripts/coverage-lib.ts`, `scripts/coverage-lib.test.ts`.
- Status: active

## 248.3 The eslint-policy tests get a describe-level 30s timeout

- Decided by: work-ticket orchestrator, 2026-10-25, plan gate (plan approved by the maintainer).
- Context: The first test builds a cold type-aware ESLint program, about 6s under v8 coverage in CI, over vitest's default 5s.
- Options:
  - Chosen: `{ timeout: 30_000 }` on the `describe`, so whichever test runs first is covered; it adds no time when tests pass, so `npm run check` is unchanged.
  - Warm the `ESLint` instance in a `beforeAll`: still needs an explicit hook timeout (default 10s), so it is the same change with more code.
  - A `testTimeout` for every `scripts/` test in `vitest.config.ts`: widens the change to unrelated tests.
- Where: `scripts/eslint-policy.test.ts`.
- Revisit if: the cold lint grows past 30s, or other type-aware lint tests appear and a shared timeout fits better.
- Status: superseded by 248.5

## 248.4 CI runs the vitest suites once, under coverage in the required `check` job; the `coverage` job only merges

- Decided by: maintainer, 2026-10-25, review round 1.
- Context: The `check` job ran every unit and integration test plain, and the `coverage` job ran them all again under v8 coverage. The two runs disagreed (the eslint-policy timeout failed only under coverage), and the second run was invisible until 248.1. e2e already ran once: the required `e2e` job collects coverage and hands it on.
- Options:
  - Chosen: the `check` job runs `npm run check:static` (build, typecheck, lint, format:check), then `npm run coverage -- unit integration`, which exits 1 on a failing test (248.1) and so gates merges; it uploads the two `coverage-final.json` files. The `coverage` job runs no tests: `COVERAGE_VITEST_DIR` points `coverage.ts` at that data, as `COVERAGE_E2E_RAW_DIR` does for e2e. Local `npm run check` is unchanged (plain vitest, default timeouts).
  - Plain run in `check`, no vitest coverage: a small change, but the unit, integration and combined numbers would leave the PR comment and the baseline.
  - Keep both runs (the orchestrator's lean in review): cheap on a public repo, and 248.1 makes the disagreement visible, but it is still two sources of truth.
  - The `coverage` job with `if: !cancelled()` instead of `needs: [check, e2e]`, posting partial data when `check` fails (orchestrator, not asked): kept the existing pattern instead (the job already needed `e2e`), so a red `check` skips the coverage job and leaves the PR comment from the previous push.
- Where: `check:static` and `check` in `package.json`; the `check` and `coverage` jobs in `.github/workflows/ci.yml`; `vitestKind` in `scripts/coverage.ts`; `CLAUDE.md` (Status, Test classification and coverage, Work practices); `scripts/README.md`.
- Revisit if: coverage overhead makes the `check` job noticeably slow, or a test behaves differently under instrumentation than without it.
- Status: active

## 248.5 Coverage runs use a 30s test timeout instead of per-test timeouts

- Decided by: maintainer, 2026-10-25, review round 1.
- Context: With 248.4 the coverage run gates merges, so coverage overhead must not fail it; the maintainer asked not to tune timeouts for the coverage run.
- Options:
  - Chosen: `coverage.ts` passes `--testTimeout=30000` to its vitest runs, and the describe-level timeout in `scripts/eslint-policy.test.ts` is removed. Hooks keep vitest's 10s default. Local `npm run check` keeps vitest's defaults, so a slow test still shows there.
  - Also relax hooks: vitest 4.1.12 forwards only `testTimeout` from the command line to the inline `unit` and `integration` projects, so `--hookTimeout` was silently ignored (reviewer, round 1). It would need an env var read in `vitest.config.ts`; no hook comes near 10s today.
  - Keep the per-file timeout (248.3): a future slow test could fail the gate under coverage only and would need its own timeout.
- Where: `COVERAGE_TIMEOUT_MS` and `vitestKind` in `scripts/coverage.ts`; `scripts/eslint-policy.test.ts`.
- Revisit if: a `beforeAll` or `afterAll` hook times out under coverage only.
- Supersedes: 248.3
- Status: active
