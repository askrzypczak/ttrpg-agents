# feature: named encounters and an encounter-scoped repository

Issue: [#361](https://github.com/askrzypczak/ttrpg-agents/issues/361). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 361.1 Migration 17 deletes every encounter, instance and undo record, nulls the change log's encounter ids and adds a required, case-insensitively unique `encounters.name`

- Decided by: maintainer, 2026-11-11 (357.15: discard existing encounters; keep the change log with a null encounter). The SQL shape (explicit deletes, CHECK, `NOCASE` index) by the epic #358 orchestrator, 2026-11-13 (plan gate), not human-approved.
- Context: Old encounters have no name and no scene; 357.15 discards them rather than adopting old scenes. `seq` must never go backwards, so the change log stays.
- Options:
  - Chosen: `DELETE` from `undo_instances`, `undo_commands`, `monster_instances` and `encounters` (children first, not relying on `ON DELETE CASCADE`); `UPDATE encounter_events SET encounter_id = NULL`; `ALTER TABLE encounters ADD COLUMN name TEXT CHECK (name IS NOT NULL AND length(name) > 0)`; `CREATE UNIQUE INDEX encounters_name ON encounters (name COLLATE NOCASE)`. Maps, rooms and token art stay. SQLite cannot add a `NOT NULL` column without a non-null default, so a CHECK rejects null and the empty string. `NOCASE` folds ASCII letters only.
  - Keep the encounters and name them on upgrade: contradicts 357.15.
  - Delete the change-log rows too: `seq` could go backwards for a client that remembers it.
  - Fold case beyond ASCII in the store: the names this ticket creates are ASCII ("Encounter N"); DM-given names arrive with #365, which owns wider folding.
- Where: migration 17 in `packages/store-sqlite/src/migrations.ts`.
- Revisit if: #365 accepts DM-given names that differ only in non-ASCII case.
- Status: active

## 361.2 The engine names new encounters "Encounter N" with the lowest free N, ignoring case; the store only enforces uniqueness

- Decided by: maintainer, 2026-11-11 (357.14: "Encounter N", the next free number; 357.2: the engine computes every number). Reading "next free number" as the lowest free N by the epic #358 orchestrator, 2026-11-13 (plan gate, Q4), not human-approved.
- Context: The store needs a name for every new encounter; 357.14 names them "Encounter N".
- Options:
  - Chosen: `nextEncounterName(names)` in the engine returns "Encounter N" with the lowest N >= 1 that no given name takes, ignoring case.
  - One more than the highest number: collapses to the same answer until numbered encounters are renamed, then skips free numbers.
  - A persisted counter: new persisted state for no reader.
  - The store picks the name: a number computed outside the engine (357.2).
- Where: `nextEncounterName` in `packages/engine/src/encounter/directory.ts`.
- Status: active

## 361.3 `EncounterDirectory` absorbs `ActiveEncounterReader`; the snapshot reads the current encounter before its instances

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate; the #360 gate left the choice to #361's planner), not human-approved.
- Context: #360 added `ActiveEncounterReader` so the snapshot could name the active encounter without creating one. #361 adds a port that lists encounters and reads the current one.
- Options:
  - Chosen: delete `ActiveEncounterReader`; its method moves onto `EncounterDirectory` as `getCurrentEncounter()` with the same contract (never creates). `snapshotMessage(encounters, artRepo, log)` reads the log's latest `seq`, the art, the current encounter, then that encounter's scoped repository's instances and restore seqs. Instances now come from the named encounter's repository, so #360's reason to read the id after the instances is gone.
  - Keep the interface beside the port: two ways to read the current encounter.
  - Extend the interface: a second port that only the snapshot reads.
- Where: `EncounterDirectory` in `packages/engine/src/encounter/directory.ts`; `snapshotMessage` in `packages/bridge/src/encounter-bridge.ts`.
- Status: active
- Supersedes: 360.3

## 361.4 A scoped repository logs its own encounter's id, and no repository creates an encounter; `resolveEncounter` creates one

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate), not human-approved.
- Context: 360.2 had the repository create the active encounter on a clear of an empty store so no event it logs is null. A repository scoped to one encounter always has an id.
- Options:
  - Chosen: `SqliteEncounterRepository(db, encounterId, options?)` writes its own id on every change-log row, with no lookup; `getOrCreateActiveEncounter` leaves `EncounterRepository`. The command that needs an encounter gets one from `resolveEncounter(directory)`: the current encounter, or a new "Encounter N" made current, in one transaction. It is a stopgap that #363's resolution rule replaces.
  - Keep a create-on-demand method on the repository: a repository could then act on an encounter other than its own.
- Where: `packages/store-sqlite/src/sqlite-repository.ts`; `resolveEncounter` in `packages/engine/src/encounter/directory.ts`.
- Revisit if: #363's resolution rule lands (it replaces `resolveEncounter`).
- Status: superseded by 363.3
- Supersedes: 360.2

## 361.5 The MCP resolves the encounter lazily, once per tool call; a tool that never reads the encounter resolves none

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate, Q4), not human-approved. The MCP reads the current encounter from the store on every call: maintainer, 2026-11-11 (epic #358 body).
- Context: The MCP server is a second process; it learns a change of the current encounter through the shared database. Resolving creates an encounter when none is current.
- Options:
  - Chosen: `defineTool` hands `run` a `ToolCallContext` whose `repo` getter resolves on first access and caches the repository for the rest of the call. `search_monsters`, `get_statblock`, `open_statblock`, `setup_status`, `list_rooms`, `get_map_image` and `propose_rooms` never touch it and create nothing; `use_map`, `set_rooms` and `remove_rooms` note an undo record, so they resolve one. A read tool on an empty store creates "Encounter 1" (the ticket; #363's rule 4); replies do not change.
  - Resolve eagerly before every call: `search_monsters` would create an encounter.
  - A per-tool "touches the encounter" flag: a declaration on 33 tools that #363 would reshape into read and write forms.
- Where: `ToolCallContext` in `packages/mcp/src/context.ts`; `defineTool` in `packages/mcp/src/tools.ts`.
- Revisit if: #363 splits resolution into read and write forms.
- Status: active

## 361.6 A table edit or token deletion acts on the encounter that holds the instance, through the engine's `repositoryForInstance`

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate; CLAUDE.md "Where code goes"), not human-approved.
- Context: With several encounters, a table write-back names an instance, not an encounter, and the current encounter may be another one.
- Options:
  - Chosen: `repositoryForInstance(directory, instanceId)` in the engine returns the repository of the encounter whose instances (live or removed) include the id, and throws `UnknownInstanceError` when none does. The bridge's `removeInstance` and `editInstance` call it inside their existing `try`, so "no encounter holds it" is the same refusal as before. A removed instance still gets the repository's own `UnknownInstanceError`.
  - The bridge composes `findEncounterOfInstance` and `repositoryFor` itself: a rule in an adapter.
  - Act on the current encounter: an edit in a scene of another encounter would be refused or change the wrong encounter.
- Where: `repositoryForInstance` in `packages/engine/src/encounter/directory.ts`; `removeInstance` and `editInstance` in `packages/bridge/src/encounter-bridge.ts`.
- Status: active

## 361.7 An undo record reads only its encounter's change-log rows; rows with no encounter never enter one

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate), not human-approved.
- Context: An undo record lists the change-log events after the command's first write that the command made or whose origin is `table`. With several encounters, a `table` event of another encounter would make undo refuse or revert the wrong thing.
- Options:
  - Chosen: `latestUndoRecord` reads events with `seq > base_seq AND encounter_id = ?`, then keeps the existing `table`-or-own-command filter. Rows from before migration 16 and Epic O's art events have a null encounter and are never listed.
  - Read every row and filter by the event's instance: parses the log's JSON (281.3 and 282.3 rejected that) and misses events of removed instances.
- Where: `latestUndoRecord` in `packages/store-sqlite/src/sqlite-repository.ts`.
- Status: active

## 361.8 `resolveEncounter` takes the write lock only to create an encounter, and reads the current one again inside it

- Decided by: implementer, 2026-11-13 (build); kept by the epic #358 orchestrator's builder in review round 1, which added the test of the re-read; not human-approved.
- Context: Every MCP call that reads the encounter resolves it, and two processes share the database. A write transaction (`BEGIN IMMEDIATE`) on every call would serialise reads behind the bridge's and the other process's writes.
- Options:
  - Chosen: read the current encounter outside a transaction and return it when there is one. Only when there is none, open the write transaction, read again (another process may have made one current since), and create "Encounter N" only if there is still none.
  - A write transaction on every call: simpler, one read, but every read-only tool call takes the write lock.
  - No re-read inside the transaction: two processes that both find none would create "Encounter 1" and "Encounter 2", and the second would switch the current encounter.
- Where: `resolveEncounter` in `packages/engine/src/encounter/directory.ts`; test "resolveEncounter returns the encounter another process made current after its first read, and creates none" in `directory.test.ts`.
- Revisit if: #363's resolution rule replaces `resolveEncounter`.
- Status: superseded by 363.3
