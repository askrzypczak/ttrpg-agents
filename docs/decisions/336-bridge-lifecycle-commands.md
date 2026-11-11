# feature: bridge start, stop, restart and status commands, for normal use and for testing a branch

Issue: [#336](https://github.com/askrzypczak/ttrpg-agents/issues/336).

## 336.1 `bridge:restart` stops the running bridge before it builds

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: Building first would keep the old bridge up through a failed build. But `npm run build` ends with the owlbear vite build, and `emptyOutDir: true` (`packages/owlbear/vite.config.ts`) empties `packages/owlbear/dist` before writing. So a vite failure in the same checkout would leave the old bridge serving a partial extension, which is the mixed-build state the ticket complains about.
- Options:
  - Chosen: stop, then start (start builds, then spawns), as the ticket says. A failed build leaves no bridge running, and `bridge:status` says so.
  - Build, then stop: the table stays up during the build, but a vite failure leaves a partial `dist` served. It would also need one more test and a README caveat.
- Where: `restartBridge` in `scripts/bridge-lifecycle.ts`.
- Revisit if: the owlbear build stops emptying its output directory, or restart downtime becomes a problem in play.
- Status: active

## 336.2 `bridge:status` also reports the GM tab and a port held without a record

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: The ticket asks for the GM tab only "if that is cheap to read", and its AC leave both lines out. Without a port probe, the first `bridge:start` after this ships (the running bridge has no state file) sends the user to `bridge:status`, which would then say "not running".
- Options:
  - Chosen: both. The GM tab comes from a `scene-status` query on `POST /agent/query` with the agent token, which is never printed: 503 means not connected, 200, 502 or 504 means connected, and anything else means unknown. With no live record, status tries a TCP connect to the port and says when something else holds it.
  - Port probe only: no token read, no query per status call.
  - Neither: only the ticket's fields.
- Where: `bridgeStatus` in `scripts/bridge-lifecycle.ts`.
- Status: active

## 336.3 The second-worktree restart is a manual check, not a test

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: The ticket's AC asks that `bridge:restart` from a second worktree leave the bridge on that worktree's build. A second worktree inside a test needs `npm ci` and a full build, which means minutes and npm registry access on every run.
- Options:
  - Chosen: an integration test of restart in the repo's own checkout, status tests for a different checkout or commit, and one manual run from a real second worktree, recorded in the PR.
  - An automated second-worktree test: slow, needs the registry in CI, likely flaky.
- Where: `scripts/bridge-lifecycle.integration.test.ts`; the PR's Test proof.
- Status: active

## 336.4 A record is the bridge only if its pid is alive, runs `cli.js` and started at the recorded time

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: A state file left behind by a crash can name a pid that has since been reused. The ticket rules out an HTTP route for stopping, and an identity route would grow the HTTP surface in the same way.
- Options:
  - Chosen: `process.kill(pid, 0)`, then `ps -o etime= -o args= -p <pid>`, with one `-o` per column. POSIX and BSD `ps` read everything after `=` as the header, so the comma form `etime=,args=` would be a single column on macOS (found in review round 1). The command line must contain `cli.js` and must not be `<defunct>`, and `now - etime` must be within 3 s of the recorded `startedAt` (`performance.timeOrigin`). Any failure, `ps` missing included, means "not the bridge", so the result is never a wrong signal.
  - Pid only: a reused pid gets signalled.
  - An HTTP identity route: grows the bridge's HTTP surface.
  - `ps -o lstart=`: its output depends on the locale.
- Where: the module-private identity check in `scripts/bridge-lifecycle.ts`.
- Revisit if: the bridge runs on a platform without `ps`, or anything other than `node .../cli.js` launches it.
- Status: active

## 336.5 `cli.ts` records itself after listening and before it prints the token

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: The lifecycle commands need pid, port, checkout, commit and start time from both detached and foreground bridges, and `bridge:start` needs a signal that the bridge is listening.
- Options:
  - Chosen: once the server is listening, `cli.ts` writes `{ pid, port, checkout, commit, startedAt }` as JSON to `BRIDGE_STATE_FILE` (default `~/.config/ttrpg-agents/bridge-state.json`): mode 0600, atomically (temp file plus rename), before it prints the install URL. `bridge:start` waits for a record carrying its child's pid, and a log that ends before any record exists holds no token. On SIGINT or SIGTERM the bridge removes the file only if the file still records its own pid, so another bridge's record sharing the file survives.
  - The launcher writes the record: a foreground `npm run bridge` would have none.
  - A bare pid file: cannot report the port, checkout or commit, or tell a reused pid.
- Where: `packages/bridge/src/state-file.ts`; `packages/bridge/src/cli.ts`.
- Status: active

## 336.6 The state-file module lives in the bridge package, and the root script imports its source

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: `cli.ts` writes the record and the root script reads it, so the format needs one definition. The script runs under Node type stripping, and `bridge:start` runs before any build.
- Options:
  - Chosen: `packages/bridge/src/state-file.ts` (Node built-ins only). `scripts/bridge-lifecycle.ts` imports it, and `token-file.ts`, by relative path. `scripts/` is not a workspace package, so this adds no `package.json` edge and no lint exception.
  - Import the built `dist/`: `bridge:status` would break in an unbuilt checkout.
  - The script parses the JSON itself: two copies of the format.
- Where: `scripts/bridge-lifecycle.ts`; `packages/bridge/src/state-file.ts`.
- Revisit if: `state-file.ts` needs a workspace import, which type stripping cannot resolve from source.
- Status: active

## 336.7 Root `npm run bridge` runs the CLI directly, not through the workspace's `start`

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: The ticket's AC wants a taken port to print one line. A nested `npm run start -w` that exits 1 adds seven `npm error Lifecycle script` lines, while a root script that exits 1 prints only its own stderr (checked in a scratch package).
- Options:
  - Chosen: `"bridge": "node packages/bridge/dist/cli.js"`. The process and logs are the same. The cwd becomes the repo root, and nothing reads it: the static dir and checkout come from `import.meta.url`, and the tokens and DB from env or home.
  - Keep the nested run and accept npm's trace: fails the AC.
- Where: root `package.json`.
- Status: active

## 336.8 `bridge:start` builds only when no bridge is running, and the detached log is fresh per start

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: The ticket wants `bridge:start` to "change nothing" when a bridge is running. A build would rewrite the `dist/` a running bridge from the same checkout serves.
- Options:
  - Chosen: check the record first, and build only when nothing is running. `bridge.log` sits beside the state file, is truncated at each start and set to mode 0600, also when it already exists. Start prints the log path, not the install URL, so no command prints a token.
  - Build first: a refused start would still have changed the served extension.
  - An appending log: keeps history but grows without bound.
- Where: `startBridge` in `scripts/bridge-lifecycle.ts`.
- Status: active

## 336.9 The lifecycle functions take the build as an option, and the tests never run the real build

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (in the approved plan).
- Context: The real `npm run build` takes tens of seconds, and its vite step empties `packages/owlbear/dist` while other test files run.
- Options:
  - Chosen: `LifecycleOptions.build`. `scripts/bridge.ts` passes `npm run build` in the checkout, and the tests pass fakes.
  - An environment switch or flag that skips the build: a test-only seam in the command's surface.
- Where: `scripts/bridge-lifecycle.ts`, `scripts/bridge.ts`.
- Status: active

## 336.10 Edge cases of the record: timing tolerance, stale and unreadable files, unknown commits

- Decided by: implementer, 2026-11-06, implementation (the reviewer asked for it to be logged in review round 1).
- Context: The plan fixed the identity check and the commands, but not these details.
- Options:
  - Chosen:
    - The 3 s window is measured against an interval: the time is read before and after `ps`, and one more second is allowed because `etime` is truncated to whole seconds.
    - `start` removes a stale record before it builds.
    - `stop` and `status` leave a state file they cannot parse in place.
    - `status` warns on a commit mismatch whenever the two commits differ, including when only one is unknown. A pair where both are unknown gets no warning.
  - One `now`, taken after `ps`: under load, a slow `ps` call can push a live bridge past the window.
  - Delete an unparseable file: it might be a newer format's record, or the user's own file at that path.
  - Stay silent when one commit is unknown: hides a checkout where git failed.
- Where: the identity check, `startBridge`, `stopBridge` and `bridgeStatus` in `scripts/bridge-lifecycle.ts`.
- Status: active
