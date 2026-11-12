# feature: one config file read by every process, with environment reads moved to the composition roots

Issue: [#369](https://github.com/askrzypczak/ttrpg-agents/issues/369).

The loader itself (one optional `config.json`, environment then file then default, the package `@ttrpg-agents/config`, not a port) is the maintainer's decision 357.9 and the epic #366 plan; the entries below are the choices this ticket made inside it.

## 369.1 The loader knows five settings; the extension token file is not one of them

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The ticket's settings table has an "Extension token file" row (`BRIDGE_TOKEN_FILE`). #446, integrated into the epic branch before this ticket was built, removed the extension token and its file.
- Options:
  - Chosen: five settings: database, bridge port, agent token file, bridge state file, extension files. #446 runs first, so no setting is added only to be removed.
  - Build the six-row table and let #446 remove the row: two tickets edit the same lines of `cli.ts`, `token-file.ts` and the docs.
- Where: `SETTINGS` (`packages/config/src/config.ts`); `docs/settings.md`.
- Status: active

## 369.2 The loader's tests are integration tests that write real temp files; no file-reading seam

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The ticket asks for unit tests of the loader, but the loader reads `config.json` from disk, and CLAUDE.md classifies a test that writes files or uses temp dirs as an integration test.
- Options:
  - Chosen: `config.integration.test.ts`, with a temp home and temp XDG directories per test; `loadConfig` takes only the environment, the home directory and the checkout.
  - Inject a file reader so the tests are unit tests: a parameter only tests would use.
- Where: `packages/config/src/config.integration.test.ts`; `ConfigInputs` (`packages/config/src/config.ts`).
- Status: active

## 369.3 Every path setting, from the file or the environment, is absolute or starts with `~/`; anything else is an error

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: A relative path would resolve against whatever directory the process started in, which differs between the MCP server (started by Claude Code), the bridge and the scripts. The orchestrator checked every setter of the four path variables on the epic branch: all pass absolute temp paths.
- Options:
  - Chosen: one rule for both sources: absolute, or `~/` expanded against the home directory; anything else is an error and the next source is used.
  - Check only `config.json` paths and use environment paths as given: two rules, and a relative variable would still depend on the working directory.
- Where: `loadConfig` (`packages/config/src/config.ts`); `docs/settings.md`.
- Status: active

## 369.4 Every value present in any source is validated, also one that a higher source overrides

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: An environment variable can hide a bad `config.json` value, which would then break the first process started without that variable.
- Options:
  - Chosen: a bad `config.json` value is an error even when its environment variable is set.
  - Validate only the value in effect: a broken file goes unnoticed until the override is removed.
- Where: `loadConfig` (`packages/config/src/config.ts`).
- Status: active

## 369.5 Every composition root prints all problems to stderr and exits 1 on any error; warnings do not stop the process

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The loader returns problems instead of throwing. An unknown key is a warning (a typo should be visible); an invalid value or an unreadable or malformed file is an error. The MCP server speaks JSON-RPC on stdout.
- Options:
  - Chosen: each root writes every problem's message to stderr, then exits 1 if any is an error, before it opens the database or a port. The MCP server writes nothing to stdout.
  - Start with the next source's value and only warn: the process would run against a database or port the DM did not choose.
- Where: `packages/mcp/src/stdio.ts`; `packages/bridge/src/cli.ts`; `scripts/bridge.ts`; `packages/store-sqlite/scripts/import-token-art.ts`.
- Status: superseded in part by 371.5 (`npm run status` reports config errors as rows and exits 0; the other roots keep this rule)

## 369.6 An empty or relative `XDG_*` value is ignored, and an empty project variable counts as unset

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The XDG Base Directory spec says relative values are invalid and are ignored. `cli.ts` and `db.ts` already treated an empty `BRIDGE_PORT` or `TTRPG_AGENTS_DB` as unset.
- Options:
  - Chosen: follow the spec for `XDG_CONFIG_HOME` and `XDG_DATA_HOME`; treat every empty project variable as unset.
  - Report an empty variable as an invalid value: `VAR= npm run ...` would become an error where it was a no-op.
- Where: `loadConfig` (`packages/config/src/config.ts`).
- Status: active

## 369.7 The two scripts load the loader by source path: no `store-sqlite -> config` edge and no lint block for package scripts

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: `scripts/bridge.ts` runs before any build (336.6), and `packages/store-sqlite/scripts/import-token-art.ts` runs from source. 221.6 kept the store's scripts directory free of a lint block; its Context ("imports only `@ttrpg-agents/engine` and its own package") is no longer true, but its decision stands.
- Options:
  - Chosen: both import `packages/config/src/config.ts` by relative path; `config.ts` has no relative imports, so plain Node loads it from source.
  - A `store-sqlite -> config` manifest edge and import through `dist`: an edge for one maintainer script, and the store package's `src` would be allowed an import it must not use.
- Where: `scripts/bridge.ts`; `packages/store-sqlite/scripts/import-token-art.ts`.
- Revisit if: `config.ts` needs a relative or workspace import, which type stripping cannot load from source.
- Status: active

## 369.8 The token art import also exits 1, before it opens the database, when the config has an error

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate (a spec-audit conflict), not human-approved.
- Context: 221.4 (epic #217 orchestrator) says the script exits 1 only for usage errors. The ticket asks every composition root to exit 1 on an invalid config value.
- Options:
  - Chosen: supersede 221.4 in part: usage errors and config errors exit 1; a run that imported, rejections included, still exits 0.
  - Warn and use the default database: the import would write art into a database the DM did not name.
- Where: `packages/store-sqlite/scripts/import-token-art.ts`.
- Supersedes: 221.4 (in part)
- Status: active

## 369.9 CLAUDE.md names `scripts/bridge.ts` a composition root

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The list named only the roots that wire adapters together. The epic's rule "only composition roots read settings" must cover the root script that reads them.
- Options:
  - Chosen: add `scripts/bridge.ts` and `packages/store-sqlite/scripts/import-token-art.ts` to the list.
  - Keep the list to adapter-wiring roots: the settings rule would need its own list.
- Where: `CLAUDE.md` (Architecture, composition roots).
- Status: active

## 369.10 The unbuilt-checkout test copies `config.ts` alone into an empty directory

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The ticket asks that `node -e` importing `config.ts` by path works in an unbuilt checkout. Deleting `dist/` in the test checkout would race the other tests.
- Options:
  - Chosen: copy the file alone, with a `{"type":"module"}` `package.json`, into a temp directory and import it there: no `dist`, no `node_modules`, no sibling files, so any non-built-in import fails.
  - Spawn from the real checkout: `dist/` and `node_modules` are present, so the test would not prove the claim.
- Where: `packages/config/src/config.integration.test.ts`.
- Status: active

## 369.11 No environment reads outside the roots and no literal 5199 outside the loader are checked once, by grep in the PR; no permanent guard yet

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The ticket asks for the state at merge. A permanent `no-restricted-properties` rule on `process.env` belongs with the rule "only composition roots read settings", which #371 writes into CLAUDE.md.
- Options:
  - Chosen: `git grep` checks in the PR's Test proof; the lint guard is noted for #371's plan gate.
  - Add the lint rule and a scan for 5199 now: enforced, but outside this ticket's scope.
- Where: the PR body (Test proof).
- Revisit if: #371's plan gate decides on the lint rule.
- Status: superseded by 371.9

## 369.12 The exported `SETTINGS` table drives the loader and the settings-page test

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: `docs/settings.md` must list every setting the loader resolves, and a test must fail when it does not.
- Options:
  - Chosen: one exported table of name, environment variable and file key; the loader resolves from it and the test reads it.
  - The test keeps its own list of variables: a second list that can drift from the loader.
- Where: `SETTINGS` (`packages/config/src/config.ts`); `packages/config/src/config.test.ts`.
- Status: active

## 369.13 `bridge/src/client.ts` keeps its lint allowance for `./token-file.js`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate (a spec-audit cut), not human-approved.
- Context: `client.ts` imported only `defaultAgentTokenPath` from `token-file.ts`, which this ticket removes, so the allowance is unused for now. #371's bridge probe will live in `client.ts`.
- Options:
  - Chosen: the `client.ts` block keeps its relative-import allowance and message unchanged, plus the new ban on `@ttrpg-agents/config`.
  - Narrow the allowance now (a spec-audit proposal, cut): #371 would reopen the same block.
- Where: `eslint.config.js` (the `packages/bridge/src/client.ts` block).
- Status: active

## 369.14 `bridgePort` in `config.json` must be a JSON number; a string such as `"5200"` is an error

- Decided by: implementer, 2026-11-12, implementation; kept by the work-ticket orchestrator (#369 builder), not human-approved.
- Context: The plan calls the file key a JSON integer. An environment variable is always text, so `BRIDGE_PORT` is parsed from decimal digits; the file can carry a real number.
- Options:
  - Chosen: the file value must be a JSON number and an integer from 0 to 65535; a string is reported as an invalid value and the next source is used.
  - Accept a string of digits too: two spellings of one setting, and `"5200 "` or `"0x1450"` would need rules of their own.
- Where: `loadConfig` (`packages/config/src/config.ts`); `docs/settings.md` (Format).
- Status: active
