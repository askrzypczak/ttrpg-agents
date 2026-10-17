# scripts

Root-level repo tooling. Ticket automation (agent dispatch, label setup, close-time label cleanup) moved to the `askrzypczak/claude-workflow` repo.

- `coverage.ts`: `npm run coverage`. Unit, integration and e2e coverage plus a merged total. Informational only; reports land in `reports/coverage/<kind>`.
- `coverage-lib.ts`: pure helpers for `coverage.ts` (Istanbul merge and the per-kind summary table). Unit-tested in `coverage-lib.test.ts`.
- `vitest-projects.test.ts`: checks that every test file belongs to exactly one vitest project (see `vitest.globs.ts`).
