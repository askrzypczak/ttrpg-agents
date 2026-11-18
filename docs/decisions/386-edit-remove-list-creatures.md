# feature: edit, remove and list stored creatures

Issue: [#386](https://github.com/askrzypczak/ttrpg-agents/issues/386).

## 386.1 `remove_creature` is refused while a live monster in any encounter uses the creature, naming each one

- Decided by: epic #376 orchestrator, 2026-11-14, epic Q1 default (the maintainer has not confirmed), not human-approved.
- Context: Instances refer to their type by `monsterKey`. Restore, initiative, `reset_max_hp` and `change_monster_type` look the type up again and fail once it is gone.
- Options:
  - Chosen: refuse with `CreatureInUseError`, naming each live instance and its encounter and suggesting `remove_monsters` or `change_monster_type`. Removed instances are not checked: restoring one later fails with the existing `unknown_monster` message.
  - Retire the creature (hidden from `list()` and search, still served by `get()`): needs a `creatures` column, a migration and an index change.
  - Remove it and leave the instances: every later lookup of those monsters fails.
- Where: `packages/engine/src/monsters/stored-creatures.ts` (`removeCreature`), `packages/engine/src/monsters/errors.ts` (`CreatureInUseError`).
- Revisit if: the maintainer answers epic Q1 otherwise.
- Status: active

## 386.2 `edit_creature` leaves the monsters already in encounters as they are and names them

- Decided by: epic #376 orchestrator, 2026-11-14, epic Q2 default (the maintainer has not confirmed), not human-approved.
- Context: An instance copies its max HP, AC, footprint and name at add time.
- Options:
  - Chosen: live instances keep their copied max HP, AC, footprint and names; the reply counts and names them and points to `reset_max_hp`, `set_armor_class` and `change_monster_type`.
  - Update every live instance: the edit becomes an encounter write across encounters, with undo, change-log and table-sync effects, against the rule that creature tools are not encounter commands.
- Where: `packages/engine/src/monsters/stored-creatures.ts` (`editCreature`), `packages/mcp/src/creature-reply.ts` (`formatKeptInstances`).
- Revisit if: the maintainer answers epic Q2 otherwise.
- Status: active

## 386.3 An edit of a built-in key is refused with its own error; a remove of one gets the not-stored message

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: The ticket asks that an edit of an SRD key name `create_creature` with `from`. A built-in monster is not unknown, and the error `code` reaches structured callers.
- Options:
  - Chosen: `editCreature` throws `BuiltInMonsterError` (`built_in_monster`) naming `create_creature` and `from`; `removeCreature` of an SRD or unknown key throws `UnknownMonsterError`, saying built-in monsters cannot be removed and naming `list_creatures`.
  - Reuse `UnknownMonsterError` for the edit too: the code would say "unknown" for a monster the index serves.
  - A built-in error for the remove too: one more message with nothing to do but "cannot".
- Where: `packages/engine/src/monsters/stored-creatures.ts` (`editCreature`, `removeCreature`), `packages/engine/src/monsters/errors.ts` (`BuiltInMonsterError`).
- Status: active

## 386.4 The live instances of a monster key come from one query on the `EncounterDirectory` port

- Decided by: maintainer, 2026-11-11, epic #376 body and #386 body (the query sits on the encounter directory port); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (its shape and the carrying costs).
- Context: Edit and remove need the live instances of one key across every encounter, read under the write lock.
- Options:
  - Chosen: `EncounterDirectory.findLiveInstancesOfMonster(monsterKey)` returning `InstanceInEncounter { encounter, instance }`, oldest encounter first, then instance order; `SqliteEncounterDirectory` answers it with one join. `CreatureCommandDeps` extends `CreateCreatureDeps` and only widens its `directory`, so `createCreature` and its tests do not change.
  - Compose it in the engine from `listEncounters()` and `repositoryFor(id).listInstances()`: no adapter code and no test-wrapper lines, but one query per encounter, and against the ticket's port.
- Where: `packages/engine/src/encounter/directory.ts` (`EncounterDirectory.findLiveInstancesOfMonster`, `InstanceInEncounter`), `packages/store-sqlite/src/sqlite-directory.ts`, `packages/engine/src/monsters/stored-creatures.ts` (`CreatureCommandDeps`).
- Status: active

## 386.5 The status report's creature row counts the raw rows of the `creatures` table, read in the probe's read-only open

- Decided by: maintainer, 2026-11-15, in chat during #381 (the status row counts stored creatures only, no quarantine); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (raw rows, the row's place).
- Context: The index skips a row that fails `monsterSchema` (381.3), so `list_creatures` can show one fewer than the table holds after a missed migration. `npm run status` has no store, and 371.3 allows only a read-only open.
- Options:
  - Chosen: the probe sets `creatureCount` on a found database from `SELECT COUNT(*) FROM creatures` when the table exists; `getSetupStatus` adds `ok: stored creatures: N` right after the database row. A missing or unreadable file, or one older than migration 20, gives no row. This extends 371.1's order, as 372 did with the backup row.
  - Count only the rows that parse: the probe would carry every statblock and `npm run status` would parse them all, for one more port fact and its tests.
- Where: `packages/store-sqlite/src/database-probe.ts` (`createDatabaseProbe`), `packages/engine/src/setup/port.ts` (`DatabaseFile`), `packages/engine/src/setup/status.ts` (`getSetupStatus`), `packages/mcp/src/setup-status.ts`.
- Revisit if: a count above `list_creatures` confuses a DM in practice.
- Status: active

## 386.6 `edit_creature`'s `page` sets a page but cannot clear one, and an edit with no changes stores the same statblock and notes the command

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: The ticket says only "the same `changes` as `createCreature`, plus `page`".
- Options:
  - Chosen: `page` is an optional positive integer that replaces the stored page and keeps the book; without it the stored source stays. An edit with no changes replaces the record with the same statblock and notes the command, like any other edit.
  - `page: null` clears the page: one more input form with no present need.
  - Refuse an empty edit: one more branch and message for a harmless call.
- Where: `packages/engine/src/monsters/stored-creatures.ts` (`editCreature`), `packages/mcp/src/tools.ts` (`edit_creature`).
- Status: active

## 386.7 Two items from the #385 review are closed here: the mcp README names all four creature tools, and the book-tag message says a tag starts with a letter or digit

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: The #471 review left the README's "the creature tools that follow it" for this ticket, and the pattern message left out the first-character rule of 377.2.
- Options:
  - Chosen: close both here, where the creature tools are completed.
  - A separate chore ticket: one more PR for two lines.
- Where: `packages/mcp/README.md`, `packages/engine/src/monsters/create-creature.ts` (`BookTagError` message).
- Status: active
