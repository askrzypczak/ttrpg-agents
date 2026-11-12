# feature: database backup command, and docs for the two halves of one save

Issue: [#372](https://github.com/askrzypczak/ttrpg-agents/issues/372).

The command itself (`npm run db:backup`, a root script that copies the profile's database with `node:sqlite` `backup()` into the `backupDir` setting), the backup row in the setup report and the "two halves of one save" docs are the epic #366 plan. The entries below are the choices this ticket made inside it.

## 372.1 There is no restore command until scene-bound encounters (Epic M) land; the docs give the hand recovery and its effects

- Decided by: maintainer, 2026-11-12 (epic #366 open question 2, in chat).
- Context: The database is one half of a save; the Owlbear scenes are the other. A restore today leaves the scenes newer than the database: tokens of monsters added after the backup are deleted when their scene opens (`planSync`), and the scene's `placed-seq` can be above the restored change log's seqs. Epic M changes what scenes record.
- Options:
  - Chosen: wait. No restore command; `docs/architecture.md` gives the hand recovery and what it costs.
  - A restore command with guard rails now: built against what scenes record today, then redone after Epic M.
- Where: `docs/architecture.md` (Two halves of one save).
- Revisit if: Epic M (scene-bound encounters) lands.
- Status: active

## 372.2 Backups are taken on demand only, and the setup report shows the newest backup's time and age

- Decided by: maintainer, 2026-11-12 (epic #366 open question 4, in chat).
- Context: A backup protects prepared encounters and owned-book creatures; the DM needs to see when the last one was taken.
- Options:
  - Chosen: on demand only (`npm run db:backup`); the backup row in the setup report shows the newest backup and its age.
  - Also a backup before each migration on the default profile: one more write path into the DM's data on every start.
- Where: `scripts/db-backup.ts`; the `backup` row of `getSetupStatus` (`packages/engine/src/setup/status.ts`).
- Status: active

## 372.3 The backup command copies with `node:sqlite` `backup()` from a read-only connection it opens itself, and is a composition root with no lint exemption

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The bridge and every MCP server may hold the database open in WAL mode while the backup runs. The script runs in an unbuilt checkout and reads settings, like `scripts/bridge.ts` (369.9).
- Options:
  - Chosen: `new DatabaseSync(database, { readOnly: true })` and `backup()` from `node:sqlite` (an online copy that includes committed WAL pages). The script loads `packages/config/src/config.ts` by source path; the `process.env` lint rule covers `packages/*/src` only, so it needs no exemption.
  - The store's `openDatabase`: creates and migrates the file.
  - A file copy: misses the WAL, unsafe while others write.
- Where: `scripts/db-backup.ts`; `CLAUDE.md` (composition roots).
- Status: active

## 372.4 The backup goes into a file pre-created with mode 0600 by an exclusive create; a taken name or a failed copy exits 1, and a failed copy's file is removed

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The backup holds the DM's data and must never be readable by others, even for a moment. Two backups in one second would get the same name.
- Options:
  - Chosen: `openSync(path, "wx", 0o600)` before the copy (SQLite writes into the existing file, which keeps its mode); an existing name fails with `EEXIST`; a failed copy removes the file.
  - `chmod` after the copy: a window at the umask mode.
  - Overwrite an existing name: loses a backup.
- Where: `scripts/db-backup.ts`.
- Status: active

## 372.5 A backup directory inside the checkout is refused, comparing real paths; a directory the command creates gets mode 0700, and an existing one keeps its mode

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Backups stay out of the repo (review F9); a `.db` fails the data-file check only once committed (#374). A path written through a symlink can reach the checkout.
- Options:
  - Chosen: compare the checkout's real path with the real path of the backup directory's nearest existing ancestor plus the not-yet-existing remainder; create a missing directory with 0700 and leave an existing one's mode alone, as `loadOrCreateToken` does.
  - `chmod 0700` an existing directory: could change the mode of a shared folder, or of the home directory after a typo.
  - A purely lexical check: misses a path through a symlink.
- Where: `scripts/db-backup.ts`.
- Status: active

## 372.6 The newest backup is the `encounters-*.db` file with the latest modification time; the probe never creates the directory and reports an unreadable one

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The store probe gives the setup report the newest backup's facts (the ticket: "the store probe, given the backup directory"). `npm run status` must never create anything and must exit 0 whatever it finds (371.3, 371.5).
- Options:
  - Chosen: among regular files named `encounters-*.db`, the latest modification time (tie: the later name); a missing directory is `none`, any other read error is `unreadable` with the message.
  - Parse the time from the name: the name format would be defined twice, in the script and the store.
  - Any `*.db`: counts a live `encounters.db` when `backupDir` is the data directory.
- Where: `createDatabaseProbe` `checkBackups` (`packages/store-sqlite/src/database-probe.ts`).
- Status: active

## 372.7 The engine computes the backup's age in whole days from an injected clock; no backup or an unreadable directory is a warning with `take-backup`, never a problem

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: The report shows the backup's age (372.2), and the core computes every number the agent reports. A fresh setup has no backup and must still be ready.
- Options:
  - Chosen: `SetupPorts.now` (as the engine's other clocks); age = whole days, rounded down, 0 for a time after now; the row comes right after the database row. Extends 371.1's row order; 371.1 stays active.
  - A unit that changes with the age (minutes, hours, days): more branches for a value the time already shows.
  - A problem state: a fresh setup would not be ready.
- Where: `getSetupStatus`, `SetupRow`, `SetupFix` (`packages/engine/src/setup/status.ts`); `SetupPorts`, `DatabaseProbe` (`packages/engine/src/setup/port.ts`); `formatSetupStatus` (`packages/mcp/src/setup-status.ts`).
- Status: active
