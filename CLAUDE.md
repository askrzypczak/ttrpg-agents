# ttrpg-agents

Agentic tooling for D&D and TTRPGs in general: assistance for the DM during play, plus related experiments.

## Status
npm workspaces monorepo in place (`packages/core`, `packages/mcp`, `packages/owlbear`); no domain code yet.
- Stack: Node 24 (`.node-version`), npm, ESM, strict TypeScript (NodeNext), vitest, ESLint (flat config, typescript-eslint) + Prettier.
- `npm run check` = build, typecheck, lint, format:check, test (fail-fast). It is the definition of done; CI (`.github/workflows/ci.yml`) runs it on PRs and pushes to main.

## Conventions
- Owner: Tony (personal GitHub account `askrzypczak`). Private repo.
- Keep this file short; record decisions here as they are made.
- Never authorize by the client-supplied `role` (bridge `hello`); it only drives UI. Bridge clients authenticate with the token.
- Layout: npm workspaces under `packages/*` (`@ttrpg-agents/core`, `@ttrpg-agents/mcp`, `@ttrpg-agents/owlbear`). `core` has no MCP deps; `mcp` depends on `core`; `owlbear` (Vite browser extension) imports only the browser-safe `@ttrpg-agents/core/bridge` subpath and is excluded from the root typecheck (it typechecks in its own build, with DOM lib). `build` runs before typecheck because `mcp` resolves `core` through its built `dist/`. `scripts/` stays at the root.
- Owlbear extension code is tested browser-free via an SDK adapter + fake; see `packages/owlbear/README.md`. Only `obr-adapter.ts` may import `@owlbear-rodeo/sdk` (lint-enforced).

## Ticketing workflow
GitHub Issues is the source of truth; use `gh` (at `/opt/homebrew/bin/gh` if not on PATH).
- State labels: `ready` -> `in-progress` -> `needs-review`; `blocked` when waiting. `agent-ok` marks tickets safe for unattended background agents.
- `ready` means Tony has reviewed the ticket and approved it for work. Only Tony adds it. Agents that file tickets never set `ready` or `skip-plan`, even on unblocked tickets. Agents may set type labels, `agent-ok`, and `blocked` (with `Blocked by #M`); Tony removes `agent-ok` during review if needed.
- Type labels: `bug`, `feature`, `chore`. Create/refresh all labels with `scripts/setup-labels.sh`.
- One ticket = one worktree = one branch (`issue-N-slug`) = one PR containing `Closes #N`.
- Dependencies: write `Blocked by #M` in the issue body.
- Label cleanup on close: workflow `ticket-labels.yml` strips state labels from a closed issue and removes `blocked` from dependents whose blockers are all closed (never adds `ready`). Logic in `scripts/ticket-labels.ts`.
- Agents follow the `work-ticket` skill from the `ticket-workflow` plugin (see Work practices) with an explicit ticket number, either run manually or launched by the poller below. Agents never pick tickets themselves.

### Automatic dispatch (local)
`scripts/agent-poller.sh` runs every 3 min from a LaunchAgent (`scripts/install-launchd.sh`; run it from the main checkout) and starts one interactive background session `ttrpg-N` (visible in `claude agents`) per open `ready` + `agent-ok` ticket authored by `askrzypczak`.
- The session follows `work-ticket`, including the plan sign-off: it shows as `blocked` in `claude agents` until you attach and approve (`claude attach ttrpg-N`). Same for questions and permission prompts.
- Label `skip-plan` on easy tickets to launch with `work-ticket N auto`, which skips the sign-off (the agent still asks if the ticket is ambiguous or risky).
- Failures: a session that fails, is stopped, or ends without handing off gets `agent-failed` plus a comment. Remove it and re-add `ready` to retry.
- No concurrency limit: every eligible ticket gets a session on the next poll. Dry run: `scripts/agent-poller.sh --dry-run`. Log: `~/Library/Logs/ttrpg-agents.log`. Extra `claude --bg` flags via `CLAUDE_BG_FLAGS`.
- One-time: trust this directory by running `claude` in it once; `claude --bg` fails in an untrusted workspace.

## Work practices
- The workflow itself (skills `work-ticket`, `address-feedback`; subagents `implementer`, `reviewer`; `grg.sh`) lives in the private plugin marketplace repo `askrzypczak/claude-workflow` (local clone `~/Projects/claude-workflow`), enabled in `.claude/settings.json`. Change the workflow there, not here. The guardrails and these conventions stay in this repo.
- Flow: plan (plan mode) -> **Tony signs off** -> `implementer` subagent -> green/red/green test proof -> `reviewer` subagent (complex changes only) -> PR with CI green -> **Tony reviews** -> `address-feedback` skill (summarise, ask questions, then fix).
- The local `main` checkout can be stale. Before planning or filing tickets, `git fetch origin` and read `origin/main` (`git show origin/main:<path>`, `git ls-tree`), not the working tree.
- Models: orchestrator in the main session; once a plan is approved, `implementer` defaults to haiku/xhigh (sonnet/medium for subtle logic, opus for the hardest; the tier is set in the approved plan); `reviewer` is opus/medium.
- Tests are mandatory. No TDD requirement; instead prove tests with green/red/green: the plugin's `grg.sh` (mechanical) plus targeted breaks of the implementation for logic-heavy code. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by `.claude/hooks/guard-git.sh` (tests: `.claude/hooks/test-guard-git.sh`) and deny rules in `.claude/settings.json`. GitHub branch protection is unavailable on this free private repo.
- PRs are opened as active (not draft): this is a team of one human, so draft would only signal "review needed", which the `needs-review` label already does. `npm run check` (once scaffolded) is the single definition of done and what CI runs.

## Mutation testing
- `npm run mutate` runs Stryker (`stryker.config.json`, incremental; results in `reports/`, HTML at `reports/mutation/index.html`). Run `npm run build` first: `mcp` tests resolve `core` through `dist/`, which the Stryker sandbox only has if it was built.
- Scope it with e.g. `npm run mutate -- --mutate 'packages/core/src/dice/*.ts,!packages/core/src/dice/*.test.ts'` (a CLI `--mutate` replaces the config's test/`index.ts` exclusions, so repeat them); add `--force` to ignore the incremental cache.
- Outside `check` and CI. Use it to back up new-module PRs where `grg.sh` says `PASS (weak)`.
- Noise rules: `StringLiteral` and `OptionalChaining` mutants are excluded globally (config). Silence other equivalent mutants inline with `// Stryker disable next-line <Mutator>: <reason>`.
- vitest is pinned to `^4`: `@stryker-mutator/vitest-runner` 10.0.0 does not work with vitest 5 (bogus ~9% scores vs ~81%). Revisit and unpin when the runner supports vitest 5.
