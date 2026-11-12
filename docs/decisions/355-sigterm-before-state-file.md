# bug: a SIGTERM right after the bridge writes its state file kills it before its signal handlers exist

Issue: [#355](https://github.com/askrzypczak/ttrpg-agents/issues/355).

## 355.1 The test sends SIGTERM from an `fs.watch` on the state file's directory

- Decided by: work-ticket orchestrator, 2026-11-11, plan gate (in the approved plan).
- Context: The window is between the state file's final `rename` and the moment `cli.ts` registers its handlers. The existing test polls for the file every 100 ms, so it hits the window only by chance: it failed once under load in #278 and passed on rerun.
- Options:
  - Chosen: the test creates the state file's directory before it spawns the bridge and watches it with `fs.watch`. It sends `SIGTERM` the moment the state file exists, with a poll as a fallback so a missed event cannot hang it. In a scratch copy of the old order this killed the process 40 times out of 40. After the fix the handlers exist before the file does, so the test passes whatever the timing.
  - The existing polling test only: it passes reliably after the fix but never targets the window.
  - A `--require` preload that patches `fs/promises.rename` in the child so that it signals itself right after the rename: deterministic, but it patches a Node built-in from a test.
- Where: `packages/bridge/src/cli.integration.test.ts`.
- Status: active

## 355.2 A signal during the state-file write is covered by reading the code, not by a test

- Decided by: maintainer, 2026-11-11, plan gate.
- Context: The handler waits for the in-flight write before it removes the file, so a signal during the write leaves no state file. The write is a temp file followed by a rename, only microseconds apart, so a test triggered from outside the process cannot reliably land between them.
- Options:
  - Chosen: code reading in review, noted in the PR.
  - A second test with a `--require` preload that patches `fs/promises.rename` so the bridge signals itself just before a delayed rename, asserting that the directory ends up empty: deterministic, but about 15 lines of test-only code patching a Node built-in.
  - A second `fs.watch` test triggered by the temp file: it may pass by timing even if the wait were dropped.
- Where: the `SIGINT`/`SIGTERM` handler in `packages/bridge/src/cli.ts`.
- Revisit if: the handler's shutdown sequence grows, or a state file is found left behind after a stop.
- Status: active
