# feature: undo the agent's last encounter change

Issue: [#283](https://github.com/askrzypczak/ttrpg-agents/issues/283).

## 283.1 The store keeps a generic before-state record per MCP command

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (preference 1), not human-approved; that undo records what is needed to reverse each MCP command and writes the earlier values back through the repository is the maintainer's (#283).
- Context: the change log records values after a change only, so undo needs the values from before it.
- Options:
  - Chosen: migration 14 adds `undo_commands` (one row per MCP command: its name, the change-log seq before its first write) and `undo_instances` (per command, each instance it wrote, with the full `MonsterInstance` JSON from before the command's first write to it, NULL when the command added it). Every repository mutation with an `mcp` origin inserts these rows if absent, in its own transaction. Undo writes the values back through the existing setters (`changeMonsters`, `renameInstance`, `setMaxHp`/`setHp`, `setArmorClass`, `setInitiative`, `setGroupId`, `setStatsVisible`, `setSpawnPositions`, `restoreInstances`, `removeInstances`), so every tool, and any future one, is covered by construction.
  - Per-tool inverse logic: each tool and each future tool needs its own inverse.
  - One undo column per instance field: every future instance column needs a matching undo column.
- Where: migration 14 (`packages/store-sqlite/src/migrations.ts`); `SqliteEncounterRepository` (`packages/store-sqlite/src/sqlite-repository.ts`); `UndoRecord`, `EncounterRepository.latestUndoRecord` (`packages/engine/src/encounter/repository.ts`); `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Status: active

## 283.2 The command's name travels on the `ChangeOrigin` type only, not in the change log or on the wire

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved (spec audit).
- Context: the reply names the tool it reversed ("Undid apply_damage: ..."). The undo record needs that name, but nothing reads it from the log.
- Options:
  - Chosen: `ChangeOrigin` is `z.infer<typeof changeOriginSchema> & { command?: string }`. `defineTool` gives each tool's `run` an `origin()` that builds `{ source: "mcp", commandId, command: <tool name> }` once per call, replacing `mcpOrigin`. The store writes the name to `undo_commands.command` and keeps logging `{ source, commandId }`.
  - The name in `changeOriginSchema`, so it is in the log and in `encounter-event`s: nothing there reads it.
  - A separate `nameCommand` port write per command: a second transaction, and a name lost on a crash between the two.
  - A reply without the tool name: the DM cannot tell what was reversed.
- Where: `ChangeOrigin` (`packages/engine/src/encounter/origin.ts`); `defineTool` (`packages/mcp/src/tools.ts`).
- Status: active

## 283.3 An undo is one repository transaction that forgets the undone command and its own record

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (preference 3: repeated undo, no redo, an undo never undone), not human-approved; the transaction port method is this plan's.
- Context: an undo makes several writes under its own `mcp` command id, which the generic rule (283.1) records like any command.
- Options:
  - Chosen: `EncounterRepository.transaction(fn)` (the store's nested transaction made public). `undoLastCommand` reads, writes and calls `forgetCommands([undone, own])` inside it. A failure rolls back everything; the next undo reaches the command before.
  - No transaction: a failure part way leaves half an undo, whose own record becomes the next thing undone.
  - One repository method taking a typed list of undo writes: a wider port and a second write path.
- Where: `EncounterRepository.transaction`, `forgetCommands` (`packages/engine/src/encounter/repository.ts`); `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Status: active

## 283.4 Table wins per field: undo leaves a field the table changed after the command and names it; it writes only fields that differ

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (preference 2), not human-approved; table wins and a visible override are the maintainer's (#283, #209).
- Context: the GM may change a value at the table after the agent's command.
- Options:
  - Chosen: `latestUndoRecord` returns the change-log events after the command's first write that the command made or that have source `table`. The fields the command changed come from its own events. A field that a `table` event changed since is kept and reported `kept-table`. A field already at its earlier value is not written, so an `mcp` event never drops a table edit the extension holds without need (as 287.5).
  - Overwrite and report: silently loses the GM's edit.
  - Diff the before row against the current one: reports fields the command never touched once the table changes them.
- Where: `undoLastCommand` (`packages/engine/src/encounter/undo.ts`); `latestUndoRecord` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Status: active

## 283.5 Undo finds the command's removals in its own events, not in `removedBy` (281.3's "Revisit if" fired)

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved (spec audit).
- Context: 281.3 stored `removed_source` and `removed_command_id` so that #283 could select a command's removals; its "Revisit if" is "#282 and #283 land without reading `removedBy`".
- Options:
  - Chosen: the command's own `removed` events name the instances it removed. Once a restore has been undone, the instance's `removedBy` names the undo's command and no longer the original removal, so `removedBy` gives the wrong answer for repeated undo. The columns stay: `listRemovedInstances` and `restore_encounter` (282) read them.
  - Select by `removedBy.commandId`: wrong after an undone restore.
- Where: `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Status: active

## 283.6 Map and room changes leave a barrier: undo says it does not cover them, then reaches the encounter change before

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (preference 4), not human-approved.
- Context: `use_map`, `set_rooms` and `remove_rooms` write the map store, which has no origin. "Undo that" said after `set_rooms` must not reverse the damage before it.
- Options:
  - Chosen: the three tools call `EncounterRepository.noteCommand(origin)` after their use case succeeds. It inserts a command row with the tool's name and no instances. `undoLastCommand` that finds that row as the newest writes nothing, forgets it, and returns `not-covered`; the tool replies "The last change was <tool>, which undo does not cover; say undo again to reverse the encounter change before it." A second undo reaches the previous encounter command.
  - Skip them silently (this plan's first proposal): "undo that" after a room change would reverse the encounter change before it.
  - Undo map and room changes too: needs an origin and before-state in the map store; the maintainer proposed encounter changes only.
- Where: `noteCommand` (`packages/engine/src/encounter/repository.ts`, `packages/store-sqlite/src/sqlite-repository.ts`); `use_map`, `set_rooms`, `remove_rooms`, `undo` (`packages/mcp/src/tools.ts`).
- Status: active

## 283.7 Undo records live until a clear that clears monsters; undo right after it replies "Nothing to undo."

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (preference 5; plan-gate answer to Q2), not human-approved; that undo of `clear_encounter` is out of scope is the maintainer's (#283).
- Context: a clear purges the removed rows that earlier records could restore (282.1).
- Options:
  - Chosen: `clearEncounter` that clears at least one instance deletes every undo record of the active encounter and records none for itself; an empty clear changes no record (as 282.2). The skill sends "undo the clear" to `restore_encounter`.
  - A barrier row whose reply names `restore_encounter` (proposed addition A1): cut by the spec audit, since the ticket puts the clear out of scope and the skill already routes it.
  - Keep a fixed number of commands: no present need; the records stay one fight long, like removed rows (281.2).
- Where: `clearEncounter` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Status: active

## 283.8 Undo of an add or a restore removes the monsters as ordinary removals

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (answer to Q1), not human-approved.
- Context: `restore_encounter` restores the instances whose removal is the last clear (`removed_seq = cleared_seq`). Undo removes restored monsters with `removeInstances`, which gives them a new removal.
- Options:
  - Chosen: accept it. `restore_monsters` brings them back by name, and `list_encounter` lists them as removed; `restore_encounter` no longer sees an undone restore's set.
  - Keep each restored instance's earlier removal marker and put it back with a fourth write method: three more columns, a port method and tests, for a double correction.
- Where: `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Revisit if: the DM undoes a `restore_encounter` and then expects `restore_encounter` to work again.
- Status: active

## 283.9 A monster with no earlier spawn position keeps its token where it was moved

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved (the orchestrator asked the plan to say how undo handles it).
- Context: `setSpawnPositions` and `position-changed` take a point. A monster added without a room has `spawnPosition: null`, and its default-row slot exists only in the extension.
- Options:
  - Chosen: write nothing for it and report `kept-no-value` ("<Name> token not moved back: it had no spawn position"). The same applies to a null group or a null armor class, which the setters cannot write either; undoing a type change whose earlier AC was null keeps the current AC and reports it `kept-no-value` (implementer, rather than refusing the undo). Follow-up #306 moves such a token back.
  - A nullable `position-changed` and the extension's default-row slot in this ticket: a wire, store and extension change for one case of one tool.
- Where: `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Status: active

## 283.10 Undo removes a monster the command added even when the table edited it since

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: per-field table wins (283.4) has no field to keep when the whole instance goes.
- Options:
  - Chosen: the DM asked to undo the add, and an instance's existence belongs to the store ("Who owns what"), so the monster is removed. It stays restorable with `restore_monsters`.
  - Keep it and report: the add would not be undone.
- Where: `undoLastCommand` (`packages/engine/src/encounter/undo.ts`).
- Status: active

## 283.11 Unreadable change-log events and before-state rows are left out of the undo record

- Decided by: implementer, 2026-10-26, implementation (events: plan gate, epic #280 orchestrator), not human-approved.
- Context: a row written by a newer schema may not parse. This is the same case as `EncounterLog`'s unreadable entries.
- Options:
  - Chosen: `latestUndoRecord` leaves out an event or a `before` JSON row that does not parse, so undo still reverses what it can read.
  - Throw: one unreadable row would block every undo until the next clear.
- Where: `latestUndoRecord` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Revisit if: undo overwrites a table edit that was in an unreadable row.
- Status: active

## 283.12 The `undo` tool's structured content is `{ undone, changes }`, plus `notCovered` for a barrier

- Decided by: implementer, 2026-10-26, implementation; recorded at the reviewer's suggestion (review round 1); not human-approved.
- Context: the plan fixed the reply text and `{ undone: command, changes }` for an undo, but no shape for the other two results.
- Options:
  - Chosen: "Nothing to undo." returns `{ undone: null, changes: [] }`. A map or room barrier returns the same plus `notCovered: <tool>`. An undo returns `{ undone: <tool>, changes }`. The same keys appear in every case.
  - A `kind` field mirroring `UndoResult`: one more key that the reply text already conveys.
- Where: the `undo` tool (`packages/mcp/src/tools.ts`).
- Status: active
