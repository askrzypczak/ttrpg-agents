# ttrpg-agents

Agentic tooling for D&D and TTRPGs in general: assistance for the DM during play, plus related experiments.

## Status
npm workspaces monorepo in place (`packages/core`, `packages/mcp`, `packages/owlbear`); no domain code yet.
- Stack: Node 24 (`.node-version`), npm, ESM, strict TypeScript (NodeNext), vitest, ESLint (flat config, typescript-eslint) + Prettier.
- `npm run check` = build, typecheck, lint, format:check, test (fail-fast). It is the definition of done; CI (`.github/workflows/ci.yml`) runs it on PRs and pushes to main.

## Conventions
- Owner: Tony (personal GitHub account `askrzypczak`). Public repo, openly an agent-written test project for claude-workflow (see README). Tony is the only contributor: issues are for directing agents, outside PRs are not accepted. No license yet (all rights reserved); the SRD data is CC-BY 4.0.
- Keep this file short; record decisions here as they are made.
- Never authorize by the client-supplied `role` (bridge `hello`); it only drives UI. Bridge clients authenticate with the token.
- E2E: `npm run test:e2e` (Playwright + fake Owlbear host, `packages/owlbear/e2e`; see its README) is a separate `e2e` CI job, not part of `npm run check` (browser needed). Needs ports 5199/5200 free.
- TypeScript: `erasableSyntaxOnly` and `verbatimModuleSyntax` are on because `.ts` files run directly under Node type stripping (no enums, no constructor parameter properties, `import type` for types). Lint runs `no-floating-promises` and `no-misused-promises` (type-aware) on `packages/*/src` and `scripts`; mark intentional fire-and-forget with `void`.
- Layout: npm workspaces under `packages/*` (`@ttrpg-agents/core`, `@ttrpg-agents/mcp`, `@ttrpg-agents/owlbear`). `core` has no MCP deps; `mcp` depends on `core`; `owlbear` (Vite browser extension) imports only the browser-safe `@ttrpg-agents/core/bridge` subpath (lint-enforced: `packages/owlbear/src` may not import the `@ttrpg-agents/core` root or `node:*`; `packages/core/src/bridge/**` may not import `node:*`, `ws`, `@modelcontextprotocol/*` or `../encounter`, `../monsters`, `../index.js`) and is excluded from the root `tsc` project (`npm run typecheck` runs its own tsconfig, with DOM lib, as a second step). `build` runs before typecheck because `mcp` resolves `core` through its built `dist/`. `scripts/` stays at the root.
- Owlbear extension code is tested browser-free via an SDK adapter + fake; see `packages/owlbear/README.md`. Only `obr-adapter.ts` may import `@owlbear-rodeo/sdk` (lint-enforced).

## Test classification and coverage
- unit: `*.test.ts` (default). integration: `*.integration.test.ts`, for tests that use real SQLite, sockets, the filesystem or child processes. e2e: Playwright `*.e2e.ts`.
- `npm test` runs unit + integration (vitest projects in `vitest.config.ts`; `test:unit`, `test:integration` run one). A new test file must fit exactly one project.
- `npm run coverage` prints lines/branches/functions for unit, integration, e2e and combined; reports in `reports/coverage/<kind>`. Informational only (CI `coverage` job uploads it); not part of `check`. The PR comment headlines combined line coverage with delta vs main plus patch coverage (changed lines), per-kind table collapsed. Baseline = `coverage-summary` artifact from the latest green main run (`COVERAGE_BASELINE`); patch uses `COVERAGE_BASE_REF`.

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
- The workflow itself (skills `work-ticket`, `address-feedback`; subagents `implementer`, `reviewer`; `grg.sh`) lives in the public plugin marketplace repo `askrzypczak/claude-workflow` (local clone `~/Projects/claude-workflow`), enabled in `.claude/settings.json`. Change the workflow there, not here. The deny rules in `.claude/settings.json` and these conventions stay in this repo; the git guard ships with the plugin.
- Flow: plan (plan mode) -> **Tony signs off** -> `implementer` subagent -> green/red/green test proof -> `reviewer` subagent (complex changes only) -> PR with CI green -> **Tony reviews** -> `address-feedback` skill (summarise, ask questions, then fix).
- The local `main` checkout can be stale. Before planning or filing tickets, `git fetch origin` and read `origin/main` (`git show origin/main:<path>`, `git ls-tree`), not the working tree.
- Models: orchestrator in the main session; once a plan is approved, `implementer` defaults to haiku/xhigh (sonnet/medium for subtle logic, opus for the hardest; the tier is set in the approved plan); `reviewer` is opus/medium.
- Tests are mandatory. No TDD requirement; instead prove tests with green/red/green: the plugin's `grg.sh` (mechanical) plus targeted breaks of the implementation for logic-heavy code. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by the `ticket-workflow` plugin's git guard (claude-workflow `plugins/ticket-workflow/hooks/guard-git.sh`; change it there, not here) plus the deny rules in `.claude/settings.json`. Also enforced server-side by the `protect-main` ruleset (no bypass actors): `main` cannot be deleted or force-pushed, changes need a PR (0 required approvals), and the `check` and `e2e` CI jobs must pass. `coverage` is informational and not required. The ruleset lives in GitHub settings, not in the repo.
- PRs are opened as active (not draft): this is a team of one human, so draft would only signal "review needed", which the `needs-review` label already does. `npm run check` (once scaffolded) is the single definition of done and what CI runs.

## Mutation testing
- `npm run mutate` runs Stryker (`stryker.config.json`, incremental; results in `reports/`, HTML at `reports/mutation/index.html`). Run `npm run build` first: `mcp` tests resolve `core` through `dist/`, which the Stryker sandbox only has if it was built.
- Scope it with e.g. `npm run mutate -- --mutate 'packages/core/src/dice/*.ts,!packages/core/src/dice/*.test.ts'` (a CLI `--mutate` replaces the config's test/`index.ts` exclusions, so repeat them); add `--force` to ignore the incremental cache.
- Outside `check` and CI. Use it to back up new-module PRs where `grg.sh` says `PASS (weak)`.
- Noise rules: `StringLiteral` and `OptionalChaining` mutants are excluded globally (config). Silence other equivalent mutants inline with `// Stryker disable next-line <Mutator>: <reason>`.
- vitest is pinned to `^4`: `@stryker-mutator/vitest-runner` 10.0.0 does not work with vitest 5 (bogus ~9% scores vs ~81%). Revisit and unpin when the runner supports vitest 5 (and drop the vitest `ignore` in `.github/dependabot.yml`).
