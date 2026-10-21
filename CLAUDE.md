# ttrpg-agents

Agentic tooling for D&D and TTRPGs in general: assistance for the DM during play, plus related experiments.

## Status
npm workspaces monorepo under `packages/*` (see Architecture).
- Stack: Node 24 (`.node-version`), npm, ESM, strict TypeScript (NodeNext), vitest, ESLint (flat config, typescript-eslint) + Prettier.
- `npm run check` = build, typecheck, lint, format:check, test (fail-fast). It is the definition of done; CI (`.github/workflows/ci.yml`) runs it on PRs and pushes to main.

## Architecture
Hexagonal architecture (ports and adapters) around a domain core: Claude handles language, the core handles every number.
- **Domain core** (`@ttrpg-agents/engine`). Holds the game: rules, simulation, use cases, and the ports they need (repository, randomness, clock, ids, monster index). No I/O, no Node built-ins, no transports or SDKs. Imports no other workspace package.
- **Dependencies point inward.** Driven adapters implement the engine's ports; driving adapters call its use cases and wire adapters up at startup.
- **Enforced, not just documented.** The engine's build config sets `types: []` (no Node types), and `eslint.config.js` has per-package `no-restricted-imports` rules for the other directions (listed under Build and boundaries).
- **Where code goes.** New game logic goes in the engine. Adapters stay thin: translate input, call the engine, format output.
- **Wire contracts** (bridge messages) live in `protocol`, not in the engine.
- **Package map**: `engine` (domain core); driven adapters `store-sqlite` (encounter store) and `srd` (monster data, loader, import); driving adapters `mcp` and `bridge` (later a CLI); `protocol` (wire contract); `owlbear` (client of the bridge; may import `engine` and `protocol`).

Runtime view (processes, ports, auth, data flow): [`docs/architecture.md`](docs/architecture.md). Update that page when processes, ports, auth or the data flow change.

## Conventions
- Owner: Tony (personal GitHub account `askrzypczak`). Public repo, openly an agent-written test project for claude-workflow (see README). Tony is the only contributor: issues are for directing agents, outside PRs are not accepted. No license yet (all rights reserved); the SRD data is CC-BY 4.0.
- Keep this file short; record decisions here as they are made.
- Never authorize by the client-supplied `role` (bridge `hello`); it only drives UI. Bridge clients authenticate with the token.
- E2E: `npm run test:e2e` (Playwright + fake Owlbear host, `packages/owlbear/e2e`; see its README) is a separate `e2e` CI job, not part of `npm run check` (browser needed).
- TypeScript: `erasableSyntaxOnly` and `verbatimModuleSyntax` are on because `.ts` files run directly under Node type stripping (no enums, no constructor parameter properties, `import type` for types). Lint runs `no-floating-promises` and `no-misused-promises` (type-aware) on `packages/*/src` and `scripts`; mark intentional fire-and-forget with `void`.
- Build and boundaries: `owlbear` (Vite browser extension) imports only the browser-safe `@ttrpg-agents/engine` and `@ttrpg-agents/protocol` packages, never Node built-ins, and is excluded from the root `tsc` project (`npm run typecheck` runs its own tsconfig, with DOM lib, as a second step). Dependency direction is lint-enforced (`no-restricted-imports` in `eslint.config.js`): `owlbear/src` (tests included) may import only `engine` and `protocol` and no `node:*`; `protocol/src` may import only `engine` and no `node:*`, `ws` or `@modelcontextprotocol/*`; `store-sqlite/src` and `srd/src` import only `engine` (their tests may also import each other and `srd`); `mcp/src` does not import `bridge`; `bridge/src` (non-test) does not import `mcp`; `engine/src` (non-test) imports no workspace package. `mcp` resolves `engine` through its built `dist/`, and `bridge` resolves `engine` and `protocol` the same way; `mcp` and `bridge` resolve the store (`@ttrpg-agents/store-sqlite`) through its built `dist/` too, so each declares TypeScript project references to what it imports (their `tsconfig.build.json` files are `composite`). `mcp` resolves `srd` (`@ttrpg-agents/srd`) the same way; `store-sqlite` uses it only in its tests (a devDependency, no project reference). `build:ts` (`tsc -b tsconfig.build.json` at the root, which references every package's build config; add new packages there) is the single incremental build; `typecheck` and the vitest `globalSetup` (`vitest.global-setup.ts`) run it, so tests and typecheck never see a stale `engine`/`protocol`/`mcp` `dist/` and a fresh worktree needs only `npm ci`. Each `tsconfig.build.json` keeps its `tsBuildInfoFile` inside `dist/` so deleting `dist/` also forces a rebuild. `scripts/` stays at the root.
- Owlbear extension code is tested browser-free via an SDK adapter + fake; see `packages/owlbear/README.md`. Only `obr-adapter.ts` may import `@owlbear-rodeo/sdk` (lint-enforced).

## Test classification and coverage
- unit: `*.test.ts` (default). integration: `*.integration.test.ts`, for tests that open SQLite (including `:memory:`), sockets, child processes or temp dirs, or write files. Unit tests may read files committed to the repo (fixtures, data, source). e2e: Playwright `*.e2e.ts`.
- `npm test` runs unit + integration (vitest projects in `vitest.config.ts`; `test:unit`, `test:integration` run one). A new test file must fit exactly one project.
- `npm run coverage` prints lines/branches/functions for unit, integration, e2e and combined; reports in `reports/coverage/<kind>`. Informational only (CI `coverage` job uploads it; a separate `comment` job holds the only `pull-requests: write`); not part of `check`. CI runs e2e once: the `e2e` job uploads raw coverage, `coverage` reuses it via `COVERAGE_E2E_RAW_DIR`; `coverage-summary.json` is written only when all three kinds were collected. The PR comment headlines combined line coverage with delta vs main plus patch coverage (changed lines), per-kind table collapsed. Baseline = `coverage-summary` artifact from the latest green main run (`COVERAGE_BASELINE`); patch uses `COVERAGE_BASE_REF`.

## Ticketing workflow
GitHub Issues is the source of truth; use `gh` (at `/opt/homebrew/bin/gh` if not on PATH).
- State labels: `ready` -> `in-progress` -> `needs-review`; `blocked` when waiting. `agent-ok` marks tickets safe for unattended background agents.
- `ready` means Tony has reviewed the ticket and approved it for work. Only Tony adds `ready` and `skip-plan`. Agents that file tickets never set them, even on unblocked tickets. Agents may set type labels, `agent-ok`, and `blocked` (with `Blocked by #M`); Tony removes `agent-ok` during review if needed.
- Type labels: `bug`, `feature`, `chore`.
- One ticket = one worktree = one branch (`issue-N-slug`) = one PR containing `Closes #N`.
- Dependencies: write `Blocked by #M` in the issue body.
- Agents follow the `work-ticket` skill (see Work practices) with an explicit ticket number, run manually or launched by the dispatcher. Agents never pick tickets themselves.

Dispatch, label setup (`setup-labels.sh`) and close-time label cleanup now live in the `claude-workflow` repo (local clone `~/Projects/claude-workflow`; see its README and `dispatch/README.md`). Close-time cleanup runs through `.github/workflows/ticket-labels.yml`, which calls the reusable workflow there.
- This repo is registered in `~/.config/claude-workflow/repos.json` with session prefix `ttrpg`: sessions are `ttrpg-N`, and `ttrpg-N-conflict` for a conflicting PR.
- `skip-plan` launches `work-ticket N auto`, which skips the plan sign-off.
- A session shows as `blocked` in `claude agents` while it waits for you (plan sign-off, questions, permission prompts); `claude attach ttrpg-N` to answer.
- A failed or stopped session gets `agent-failed` plus a comment. Remove it and re-add `ready` to retry.
- Log: `~/Library/Logs/claude-workflow-poller.log`. Dry run: `dispatch/agent-poller.sh --dry-run` from the claude-workflow clone.

## Work practices
- The workflow itself (skills `work-ticket`, `address-feedback`; subagents `contract-writer`, `implementer`, `reviewer`) lives in the public plugin marketplace repo `askrzypczak/claude-workflow` (local clone `~/Projects/claude-workflow`), enabled in `.claude/settings.json`. Change the workflow there, not here. The deny rules in `.claude/settings.json` and these conventions stay in this repo; the git guard ships with the plugin.
- Flow: plan (plan mode) -> **Tony signs off** -> `contract-writer` subagent (failing tests first) -> `implementer` subagent -> `reviewer` subagent (complex changes only) -> PR with CI green -> **Tony reviews** -> `address-feedback` skill (summarise, ask questions, then fix).
- The local `main` checkout can be stale. Before planning or filing tickets, `git fetch origin` and read `origin/main` (`git show origin/main:<path>`, `git ls-tree`), not the working tree.
- Models: orchestrator in the main session; once a plan is approved, `implementer` defaults to haiku/xhigh (sonnet/medium for subtle logic, opus for the hardest; the tier is set in the approved plan); `reviewer` is opus/medium.
- Tests are mandatory. The contract tests are written first and shown red, then green after implementation, then the mutation result on the changed files (`npm run mutate:changed`) is checked. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by the `ticket-workflow` plugin's git guard (claude-workflow `plugins/ticket-workflow/hooks/guard-git.sh`; change it there, not here) plus the deny rules in `.claude/settings.json`. Also enforced server-side by the `protect-main` ruleset (no bypass actors): `main` cannot be deleted or force-pushed, changes need a PR (0 required approvals), and the `check` and `e2e` CI jobs must pass. `coverage` is informational and not required. The ruleset lives in GitHub settings, not in the repo.
- PRs are opened as active (not draft): this is a team of one human, so draft would only signal "review needed", which the `needs-review` label already does. `npm run check` is the single definition of done and what CI runs.

## Mutation testing
- `npm run mutate` runs Stryker (`stryker.config.json`, incremental; results in `reports/`, HTML at `reports/mutation/index.html`). No manual build needed: the vitest `globalSetup` rebuilds `dist/` in the Stryker sandbox.
- Scope it with e.g. `npm run mutate -- --mutate 'packages/engine/src/dice/*.ts,!packages/engine/src/dice/*.test.ts'` (a CLI `--mutate` replaces the config's test/`index.ts` exclusions, so repeat them); add `--force` to ignore the incremental cache.
- `npm run mutate:changed [base-ref]` (default `origin/main`) mutates only the production files changed since the merge-base (`git diff --name-status <base>...HEAD`, filtered by the config's `mutate` globs), with its own incremental file `reports/mutation/changed-incremental.json`. Informational: always exits 0. Writes `reports/mutation/comment.md`. Agent sessions (`work-ticket`) run it on their changed files.
- CI `mutation` job (PRs only, informational, not part of `check`): runs `mutate:changed origin/<base>`, uploads the `mutation` artifact (HTML report) and `mutation-comment`. The `comment` job posts it, and the coverage table, as separate sticky comments edited in place (found by a hidden `<!-- sticky-comment:... -->` marker).
- Excluded in `stryker.config.json` (not reachable by the vitest unit + integration projects; verified 0% line coverage there): `packages/owlbear/src/obr-adapter.ts` and `main.ts` (browser/SDK code, covered only by e2e), `packages/bridge/src/cli.ts`, `packages/mcp/src/stdio.ts` and `server.ts` (entry points exercised only in a spawned child process).
- `npm run mutate` is outside `check` and CI's required jobs.
- Noise rules: `StringLiteral` and `OptionalChaining` mutants are excluded globally (config). Silence other equivalent mutants inline with `// Stryker disable next-line <Mutator>: <reason>`.
- vitest is pinned to `^4`: `@stryker-mutator/vitest-runner` 10.0.0 does not work with vitest 5 (bogus ~9% scores vs ~81%). Revisit and unpin when the runner supports vitest 5 (and drop the vitest `ignore` in `.github/dependabot.yml`).
