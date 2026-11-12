# feature: development profile, so agent sessions and tests never open the real database

Issue: [#370](https://github.com/askrzypczak/ttrpg-agents/issues/370).

The profile itself (a linked git worktree uses `dev`, `TTRPG_AGENTS_PROFILE` wins, `dev` keeps its own files and port 5299 in a folder per checkout) is the maintainer's decision 357.13 and the epic #366 plan; the loader it extends is 369's. The entries below are the choices this ticket made inside it.

## 370.1 The profile is chosen once per process: `TTRPG_AGENTS_PROFILE`, else `dev` for a linked git worktree, else `default`

- Decided by: maintainer, 2026-11-11 (357.13, epic #366 open question 1).
- Context: Agent sessions run in linked worktrees and must not open the real database; the maintainer never starts a real live session from a worktree.
- Options:
  - Chosen: `TTRPG_AGENTS_PROFILE` (`default` or `dev`) when set; else `dev` when the checkout's `.git` is a file (a linked git worktree); else `default`. The loader stats `.git` with Node built-ins, no `git` call.
  - `dev` only on request (`TTRPG_AGENTS_PROFILE=dev`): an agent session that forgets it opens the real database.
- Where: `loadConfig`, `Profile` (`packages/config/src/config.ts`); `docs/settings.md` Profiles.
- Status: active

## 370.2 The dev folder of a checkout is its folder name plus a short hash of its path

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (Q3).
- Context: Each checkout needs its own dev folder, and the folder of a removed worktree is cleaned up by hand.
- Options:
  - Chosen: `<checkout folder name>-<first 8 hex digits of the SHA-256 of the resolved checkout path>`, with every character of the name outside `[A-Za-z0-9._-]` replaced by `_`. Readable, and two checkouts with the same folder name stay apart.
  - A bare hash (`dev/<hash12>/`): shorter code, but nobody can tell which folder belonged to a removed worktree.
- Where: `loadConfig` (`packages/config/src/config.ts`); `docs/settings.md` Profiles.
- Revisit if: the scheme changes: existing dev folders are orphaned and removed by hand.
- Status: active

## 370.3 An unknown `TTRPG_AGENTS_PROFILE` is an error and the profile falls back to the checkout kind; an empty one is unset

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: 369 reports a bad value as a problem and falls back to the next source; an empty project variable counts as unset (369.6). The composition roots exit 1 on any error problem.
- Options:
  - Chosen: the same rule for the profile: an error problem naming `TTRPG_AGENTS_PROFILE`, and the profile the checkout kind gives.
  - Refuse to resolve a profile: `LoadedConfig` would need a "no profile" state that every consumer handles, for a process that exits anyway.
- Where: `loadConfig` (`packages/config/src/config.ts`).
- Status: active

## 370.4 `extensionDir` stays in the checkout in `dev`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The other four settings move to the dev folder. The extension files are the checkout's own build, not profile data.
- Options:
  - Chosen: `<checkout>/packages/owlbear/dist` in both profiles.
  - Move it into the dev folder: a worktree's bridge would serve a build nobody makes there.
- Where: `loadConfig` (`packages/config/src/config.ts`).
- Status: active

## 370.5 A process whose profile neither the variable nor a worktree chose prints `default (not a linked git worktree)`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (Q1, spec-audit verdict 1).
- Context: The ticket asks that the profile be reported with why: the variable, a worktree, or neither. `npm run bridge` and `bridge:status` print it, and #371's status report repeats it.
- Options:
  - Chosen: one wording per reason from `describeProfile`: `dev (TTRPG_AGENTS_PROFILE)`, `default (TTRPG_AGENTS_PROFILE)`, `dev (linked git worktree)`, `default (not a linked git worktree)`.
  - Plain `default` when neither chose it: shorter, but the one case that matters most for the real data would not say why.
- Where: `describeProfile` (`packages/config/src/config.ts`); `packages/bridge/src/cli.ts`; `bridgeStatus` (`scripts/bridge-lifecycle.ts`).
- Status: active

## 370.6 Test runs point both XDG directories at a per-run temp dir and clear the setting variables

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (Q2, R5).
- Context: Tests and the processes they spawn inherit the developer's environment, and a run from the main checkout resolves `default`.
- Options:
  - Chosen: the vitest global setup and `isolateXdgDirs` (Playwright) always replace `XDG_CONFIG_HOME` and `XDG_DATA_HOME` with directories in the run's temp dir, and the vitest global setup also deletes every `SETTINGS[].env` variable from the run's environment. The vitest check spawns the MCP server from `stdio.integration.test.ts`, beside its spawn helpers.
  - Set the XDG directories only when unset: an exported real directory would reach the tests.
  - Leave clearing the setting variables to each test: an exported `TTRPG_AGENTS_DB` would reach every test that forgets.
- Where: `vitest.global-setup.ts`; `isolateXdgDirs` (`packages/owlbear/e2e/env.ts`); `packages/owlbear/e2e/playwright.config.ts`; `packages/mcp/src/stdio.integration.test.ts`.
- Status: active

## 370.7 `bridge:start` keeps forcing `BRIDGE_STATE_FILE` onto the bridge it starts

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The command waits for the state file it resolved. The spawned bridge inherits the environment and the checkout, so it resolves the same profile.
- Options:
  - Chosen: keep the force; the test proves the shared profile through a setting that is not forced (the agent token file) and the `profile:` line in `bridge.log`, with `startBridge` run in-process and a fake build (336.9).
  - Drop the force and rely on the profile alone: a mismatch would leave the command waiting on a file the bridge never writes.
- Where: `startBridge` (`scripts/bridge-lifecycle.ts`); `scripts/bridge-lifecycle.integration.test.ts`.
- Status: active

## 370.8 Tests that write `config.json` into the default profile's directory pin `TTRPG_AGENTS_PROFILE=default`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Agents run `npm run check` from linked worktrees, where a spawned process resolves `dev` and would miss a `config.json` written for `default`.
- Options:
  - Chosen: the helpers that write it and spawn a process from this checkout set `TTRPG_AGENTS_PROFILE=default` (and drop any inherited value).
  - Write `config.json` into whichever profile the checkout resolves: each helper would recompute the dev folder name.
- Where: `isolateSettings` (`packages/bridge/src/cli.integration.test.ts`); `isolatedHome` (`packages/mcp/src/stdio.integration.test.ts`); `runWithConfig` (`packages/store-sqlite/src/import-token-art-script.integration.test.ts`); `scripts/bridge.integration.test.ts`.
- Status: active
