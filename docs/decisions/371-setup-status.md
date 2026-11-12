# feature: setup status report as an MCP tool and a command

Issue: [#371](https://github.com/askrzypczak/ttrpg-agents/issues/371).

The report itself (one report of profile, config file, settings, database, bridge and GM tab, with a fix per problem; verdicts and fix codes in the engine from probe ports, wording in `mcp`; the `setup_status` tool and `npm run status`) is the epic #366 plan. The entries below are the choices this ticket made inside it.

## 371.1 The setup report's rows come in a fixed order, `ready` means no row is a problem, and the GM tab row appears only once the bridge answered

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: With the bridge down or refusing the token, nothing is known about the GM tab, and every problem row must carry a fix (AC4).
- Options:
  - Chosen: rows in the order profile, config file, config problems, settings, database, bridge, GM tab; `ready` is true when no row is in state `problem`; the GM tab row is left out until the bridge answered, since the bridge row already carries the fix.
  - A GM tab row in state unknown: a problem without a fix, against AC4.
- Where: `getSetupStatus`, `SetupRow` (`packages/engine/src/setup/status.ts`).
- Status: active

## 371.2 Three fix codes beyond the ticket's five: `restart-bridge`, `reload-gm-tab` and `check-database`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The ticket says the fix codes "include" its five. Three rows would otherwise be problems without a fix: a database older than this build, a tab that is connected but silent or without a room id (344.1), and a file that is not a database.
- Options:
  - Chosen: `restart-bridge` (the bridge migrates the database when it starts), `reload-gm-tab`, `check-database`.
  - Leave those rows without a fix: against AC4.
- Where: `SetupFix` (`packages/engine/src/setup/status.ts`); `formatSetupStatus` (`packages/mcp/src/setup-status.ts`).
- Status: active

## 371.3 The store probe opens the database read-only, never creates or migrates it, and reports an unreadable file instead of throwing

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: `npm run status` must not create or migrate the DM's database, and must exit 0 whatever it finds (AC5). A read-only open of a WAL database that no process has open leaves empty `-wal` and `-shm` files, which the next read-write close removes (SQLite's own housekeeping).
- Options:
  - Chosen: no file at the path gives `missing` without opening anything (not even the directory is created); otherwise a read-only open reads `PRAGMA user_version`, and a failed open or read gives `unreadable` with SQLite's message.
  - A read-write open: could write to the database.
  - `immutable=1`: could miss a migration still in the WAL.
- Where: `createDatabaseProbe` (`packages/store-sqlite/src/database-probe.ts`).
- Status: active

## 371.4 The bridge probe checks the token file first, reads `timeout` and `query-failed` as a connected tab that does not answer, and carries no token or bridge message

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The bridge client's error codes tell an unreachable bridge, a refused token and a missing tab apart; 502 and 504 mean the tab is connected (336.2). The bridge client sets no request timeout of its own, so a port held by a process that accepts the connection but never answers HTTP makes the probe wait for undici's header timeout (300 s); `bridge:status` aborts at 6 s.
- Options:
  - Chosen: a missing agent token file gives `no-token-file` without a query; `bridge-unreachable` gives `unreachable`, `unauthorized` gives `token-refused`, `not-connected` gives `no-gm-tab`, `timeout` and `query-failed` give `gm-tab-not-answering`, `bad-request` or a result for another query gives `unreachable`, and a `scene-status` result gives `gm-tab-connected` with its room id. A throw or rejection from the client also gives `unreachable`, so the probe never rejects (added in review round 1, epic #366 orchestrator). The facts carry the port and the token file path only. No request timeout is added here (known limit; no follow-up ticket from this run, orchestrator Q5).
  - Reuse `createBridgeTable().sceneStatus()` and catch `TableUnavailableError`: loses the error code, so an unreachable bridge, a refused token and a missing tab look the same.
- Where: `createBridgeProbe` (`packages/bridge/src/client.ts`).
- Revisit if: a hung port makes `npm run status` wait.
- Status: active

## 371.5 `npm run status` exits 0 whatever the verdict, config errors included; its launcher exits 1 in an unbuilt checkout

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: 369.5 has every composition root print config problems to stderr and exit 1 on an error. The status command exists to report such problems with a fix (AC5). An unbuilt checkout gives no report at all.
- Options:
  - Chosen: `status-cli.ts` prints config errors as rows with a `fix-config` line and exits 0; only an unexpected crash exits 1. `bin/status.mjs` prints a build hint to stderr and exits 1 when `dist/status-cli.js` is missing, like the MCP launcher. The other roots keep 369.5.
  - Exit 1 on a config error, as 369.5: against AC5.
- Where: `packages/mcp/src/status-cli.ts`; `packages/mcp/bin/status.mjs`.
- Supersedes: 369.5 (in part).
- Status: active

## 371.6 Both mcp composition roots build the settings facts inline, with the profile as `describeProfile` text

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Settings are a plain value, not an engine port (D1), and only composition roots may import `@ttrpg-agents/config`.
- Options:
  - Chosen: `stdio.ts` and `status-cli.ts` each map the loaded config to `SettingsFacts` (about seven duplicated lines); the test that compares `npm run status` with the `setup_status` reply catches drift.
  - A shared helper in a non-root mcp file: cannot import `@ttrpg-agents/config`.
  - A helper in `config`: the config package would import the engine's types, so the change would touch five packages (the split rule).
- Where: `packages/mcp/src/stdio.ts`; `packages/mcp/src/status-cli.ts`; `SettingsFacts` (`packages/engine/src/setup/port.ts`).
- Status: active

## 371.7 `ToolContext.setup` is required, and tests build it with `makeTestSetupPorts`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Nineteen existing mcp test files build a `ToolContext`, and #372 adds a backup fact to the same ports.
- Options:
  - Chosen: a required field; every test builds it with `makeTestSetupPorts` from `@ttrpg-agents/engine/testing` (one line per file).
  - A literal in each of the 19 test files: about seven lines each, edited again by #372.
  - An optional field: a production branch that only tests take.
- Where: `ToolContext` (`packages/mcp/src/context.ts`); `makeTestSetupPorts` (`packages/engine/src/testing/index.ts`).
- Status: active

## 371.8 `setup_status` replies with the report text and structured `{ ready, rows }`

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Every tool returns structured content with a `summary`.
- Options:
  - Chosen: the formatted report as the text and `{ ready, rows }` as structured content, so a structured reader needs nothing else.
  - Text only: unlike every other tool.
- Where: the `setup_status` tool (`packages/mcp/src/tools.ts`).
- Status: active

## 371.9 Lint refuses `process.env` in `packages/*/src` outside the composition roots

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (Q1).
- Context: CLAUDE.md now says only composition roots read settings, and its Architecture section asks for rules that are enforced, not just documented. 369.11 deferred the guard to this gate.
- Options:
  - Chosen: `no-restricted-properties` (object `process`, property `env`) on `packages/*/src/**/*.{ts,tsx}`, test files and the three roots (`mcp/src/stdio.ts`, `mcp/src/status-cli.ts`, `bridge/src/cli.ts`) exempt; a new root joins the exemption list with a plan line. The `import { env } from "node:process"` and `globalThis.process.env` forms are not caught and stay a review rule.
  - A review rule only (369.11's interim state): not enforced.
- Where: `eslint.config.js`; `scripts/eslint-policy.test.ts`; `CLAUDE.md` Architecture.
- Supersedes: 369.11.
- Status: active

## 371.10 A repeated fix prints under each row it belongs to

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (Q4).
- Context: A missing database and a stopped bridge both carry `start-bridge`.
- Options:
  - Chosen: each problem row prints its own fix line, so every row stands alone.
  - Print a repeated fix once: one more rule and test.
- Where: `formatSetupStatus` (`packages/mcp/src/setup-status.ts`).
- Status: active

## 371.11 An environment config problem without a key gets a generic fix line

- Decided by: implementer, 2026-11-12, implementation, not human-approved.
- Context: `ConfigProblemFact.key` is optional, so the formatter needs a fix line for an environment problem without one. The plan's wording table has none, and no loader input produces it today: every environment problem names its variable.
- Options:
  - Chosen: "correct the environment variables (see docs/settings.md)".
  - The config file's no-key wording ("correct <config path>"): would tell the DM to edit the file for an environment problem.
- Where: `formatSetupStatus` (`packages/mcp/src/setup-status.ts`).
- Revisit if: the loader reports an environment problem without a key.
- Status: active
