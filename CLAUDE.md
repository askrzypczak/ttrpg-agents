# ttrpg-agents

Agentic tooling for D&D and TTRPGs in general: assistance for the DM during play, plus related experiments.

## Status
npm workspaces monorepo under `packages/*` (see Architecture).
- Stack: Node 24 (`.node-version`), npm, ESM, strict TypeScript (NodeNext), vitest, ESLint (flat config, typescript-eslint) + Prettier.
- `npm run check` = build, typecheck, lint, format:check, test (fail-fast). It is the definition of done. CI (`.github/workflows/ci.yml`) runs the same steps on PRs and pushes to main, with the tests run once under coverage (see Test classification and coverage).

## Architecture
Hexagonal architecture (ports and adapters) around a domain core: Claude handles language, the core handles every number.
- **Domain core** (`@ttrpg-agents/engine`). Holds the game: rules, simulation, use cases, and the ports they need (repository, randomness, clock, ids, monster index). No I/O, no Node built-ins, no transports or SDKs. Imports no other workspace package.
- **Dependencies point inward.** Driven adapters implement the engine's ports; driving adapters call its use cases and wire adapters up at startup.
- **Enforced, not just documented.** The engine's build config sets `types: []` (no Node types), and `eslint.config.js` has per-package `no-restricted-imports` rules for the other directions (listed under Build and boundaries). `scripts/architecture.test.ts` holds the allowlist of workspace package-to-package edges (from each `package.json`), so a new edge is a reviewed change.
- **Where code goes.** New game logic goes in the engine. That includes any number or verdict the agent reports (for example "Owlbear is in sync"): the engine computes it. Adapters stay thin: translate input, call the engine, format output.
- **Adapters never import other adapters.** What the engine needs from outside (another process, the table, a store) is a port defined in the engine and implemented by an adapter. Lint enforces the pairs listed under Build and boundaries; the rest is a review rule.
- **Only composition roots wire adapters together.** A composition root is an entry point that builds the object graph at startup (`packages/mcp/src/stdio.ts`, `packages/bridge/src/cli.ts`); it is the one place an adapter package may import another. Every other file imports the engine (and, for `owlbear`, `protocol`) only. Runtime view: [`docs/architecture.md`](docs/architecture.md).
- **Boundary changes need a plan line.** A change that adds a workspace import edge or a lint exception (a new `no-restricted-imports` allowance) needs an explicit line in the approved plan: the per-package bans in `eslint.config.js` are allowlists, so a ticket could otherwise edit them unnoticed. Inline ESLint directives (`eslint-disable` and every other inline config comment) are ignored in production source (`packages/*/src`, non-test) via `linterOptions.noInlineConfig` in `eslint.config.js`; `npm run lint` runs with `--max-warnings 0`, so a leftover directive fails `check`. Tests, e2e and `scripts/` may still use them. An exemption in production code is a scoped block in `eslint.config.js`; one that touches `no-restricted-imports` needs the plan line above.
- **Wire contracts** (bridge messages) live in `protocol`, not in the engine.
- **Synced values declare their authority.** A feature that syncs a new value adds a row to "Who owns what" (`docs/architecture.md`, under "What reaches the table") in its plan.
- **Package map**: `engine` (domain core); driven adapters `store-sqlite` (encounter store) and `srd` (monster data, loader, import); driving adapters `mcp` and `bridge` (later a CLI; `mcp` asks the table through the engine's `TablePort`, implemented by the bridge client (`@ttrpg-agents/bridge/client`, a driven adapter), see "Queries to the table" in `docs/architecture.md`); `protocol` (wire contract); `owlbear` (client of the bridge; may import `engine` and `protocol`).

Runtime view (processes, ports, auth, data flow): [`docs/architecture.md`](docs/architecture.md). Update that page when processes, ports, auth or the data flow change.

## Conventions
- Owner: Tony (personal GitHub account `askrzypczak`). Public repo, openly an agent-written test project for claude-workflow (see README). Tony is the only contributor: issues are for directing agents, outside PRs are not accepted. No license yet (all rights reserved); the SRD data is CC-BY 4.0.
- Keep this file short. It records the current rules and conventions; their history is in the decision log (next section).
- Table wins, per field: a value changed on the Owlbear table (by the GM or anyone) stays until the agent/MCP gives that same value something new (the encounter changes it). `planSync` implements it with a baseline per owned key; a projector with several fields in one key applies it per field using the baseline passed as its third argument. Only Stat Bubbles `hide` does so today; its other fields are still one value (see `packages/owlbear/README.md`, #162).
- Never authorize by the client-supplied `role` (bridge `hello`); it only drives UI. Bridge clients authenticate with the token.
- The bridge's agent channel carries queries only. The agent changes the game through the engine's model, and the extension reconciles the scene to it. Never add a write to the table through a query.
- Supported setup is one machine with one Owlbear GM tab. The bridge keeps at most one authenticated extension client: the newest wins, and the displaced tab gets a fatal `superseded` error, stops reconnecting and shows "Connected in another tab." with a "Use this tab" button. Several GM tabs or GMs are not supported.
- E2E: `npm run test:e2e` (Playwright + fake Owlbear host, `packages/owlbear/e2e`; see its README) is a separate `e2e` CI job, not part of `npm run check` (browser needed).
- TypeScript: `erasableSyntaxOnly` and `verbatimModuleSyntax` are on because `.ts` files run directly under Node type stripping (no enums, no constructor parameter properties, `import type` for types). Lint runs `no-floating-promises` and `no-misused-promises` (type-aware) on `packages/*/src` and `scripts`; mark intentional fire-and-forget with `void`.
- Build and boundaries: `owlbear` (Vite browser extension) imports only the browser-safe `@ttrpg-agents/engine` and `@ttrpg-agents/protocol` packages, never Node built-ins, and is excluded from the root `tsc` project (`npm run typecheck` runs its own tsconfig, with DOM lib, as a second step). Dependency direction is lint-enforced (`no-restricted-imports` in `eslint.config.js`): `owlbear/src` (tests included) may import only `engine` and `protocol` and no `node:*`; `protocol/src` may import only `engine` and no `node:*`, `ws` or `@modelcontextprotocol/*`; `store-sqlite/src` and `srd/src` import only `engine` (their tests may also import each other and `srd`); `mcp/src` imports nothing from `@ttrpg-agents/bridge` except `mcp/src/stdio.ts` (the composition root), which may import only `@ttrpg-agents/bridge/client` (the Node-only HTTP client for `POST /agent/query`, which implements `TablePort`; `bridge/src/client.ts` itself imports only Node builtins, `engine`, `protocol` and `./token-file.js`, so no `ws` or server code); `bridge/src` (non-test) does not import `mcp`; `engine/src` (non-test) imports no workspace package. `mcp` resolves `engine` through its built `dist/`, and `bridge` resolves `engine` and `protocol` the same way; `mcp` and `bridge` resolve the store (`@ttrpg-agents/store-sqlite`) through its built `dist/` too, so each declares TypeScript project references to what it imports (their `tsconfig.build.json` files are `composite`). `mcp` resolves `srd` (`@ttrpg-agents/srd`) the same way; `store-sqlite` uses it only in its tests (a devDependency, no project reference). `build:ts` (`tsc -b tsconfig.build.json` at the root, which references every package's build config; add new packages there) is the single incremental build; `typecheck` and the vitest `globalSetup` (`vitest.global-setup.ts`) run it, so tests and typecheck never see a stale `engine`/`protocol`/`mcp` `dist/` and a fresh worktree needs only `npm ci`. Each `tsconfig.build.json` keeps its `tsBuildInfoFile` inside `dist/` so deleting `dist/` also forces a rebuild. `scripts/` stays at the root.
- Test fixtures: build full `MonsterInstance` values with `makeTestInstance` from `@ttrpg-agents/engine/testing` (a `./testing` subpath of the engine, test data only; lint bans it in non-test source), not with per-file literals, so a new schema key is one edit.
- Owlbear extension code is tested browser-free via an SDK adapter + fake; see `packages/owlbear/README.md`. Only `obr-adapter.ts` may import `@owlbear-rodeo/sdk` (lint-enforced).
- No mutation testing: it was removed in Epic I (#237) after per-PR runs over about 25 PRs found no production bug; do not re-add it without new evidence.

## Decision log
`docs/decisions/`: one file per ticket that made a decision ([`docs/decisions/README.md`](docs/decisions/README.md) has the format and how to search it). This file and `docs/architecture.md` hold the current rules; the log holds their history: why, the options weighed, who decided and when to revisit.

## Test classification and coverage
- unit: `*.test.ts` (default). integration: `*.integration.test.ts`, for tests that open SQLite (including `:memory:`), sockets, child processes or temp dirs, or write files. Unit tests may read files committed to the repo (fixtures, data, source). e2e: Playwright `*.e2e.ts`.
- `npm test` runs unit + integration (vitest projects in `vitest.config.ts`; `test:unit`, `test:integration` run one). A new test file must fit exactly one project.
- `npm run coverage` prints lines/branches/functions for unit, integration, e2e and combined; reports in `reports/coverage/<kind>`. Informational only (no thresholds; CI `coverage` job uploads it; a separate `comment` job holds the only `pull-requests: write`); not part of `npm run check`; a failing test makes it exit 1. CI runs each suite once: the `check` job runs `check:static` then `npm run coverage -- unit integration` (30s test timeout under coverage) and uploads the vitest data, the `e2e` job uploads raw e2e coverage, and `coverage` runs no tests, merging both via `COVERAGE_VITEST_DIR` and `COVERAGE_E2E_RAW_DIR`; `coverage-summary.json` is written only when all three kinds were collected. The PR comment headlines combined line coverage with delta vs main plus patch coverage (changed lines), per-kind table collapsed. Baseline = `coverage-summary` artifact from the latest green main run (`COVERAGE_BASELINE`); patch uses `COVERAGE_BASE_REF`.

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
- Models: the orchestrator runs in the main session; subagent models and efforts are the plugin's (see the `ticket-workflow` README, Subagents line). The approved plan may raise the `implementer` tier and says why.
- Tests are mandatory. The contract tests are written first and shown red, then green after implementation. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by the `ticket-workflow` plugin's git guard (claude-workflow `plugins/ticket-workflow/hooks/guard-git.sh`; change it there, not here) plus the deny rules in `.claude/settings.json`. Also enforced server-side by the `protect-main` ruleset (no bypass actors): `main` cannot be deleted or force-pushed, changes need a PR (0 required approvals), and the `check` and `e2e` CI jobs must pass. `coverage` is informational and not required. The ruleset lives in GitHub settings, not in the repo.
- PRs are opened as active (not draft): this is a team of one human, so draft would only signal "review needed", which the `needs-review` label already does. `npm run check` is the single definition of done; CI runs the same steps, with the tests under coverage.

## PRs and reviews
- Every PR body has a review map (reading list, criteria table, decision tests). Full guide: [`docs/reviewing.md`](docs/reviewing.md).
- One commit per layer, contract commit first; no squashing before review.
- Adapter tests prove translation only and do not re-test engine rules.
- A plan whose Interfaces touch five or more packages is split into a prerequisite ticket and a feature ticket at the plan gate.
- Rule pages (`docs/*.md`, the READMEs) state current rules in prose blocks of at most 1,000 characters (`scripts/docs.test.ts`); ticket history goes in the decision log. See `docs/reviewing.md`, section 6.
