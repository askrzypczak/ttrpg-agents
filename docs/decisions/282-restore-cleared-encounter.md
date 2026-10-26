# feature: restore an encounter after clear_encounter

Issue: [#282](https://github.com/askrzypczak/ttrpg-agents/issues/282). Part of Epic J ([#280](https://github.com/askrzypczak/ttrpg-agents/issues/280)).

## 282.1 A clear keeps the instances it removes and purges those removed before it; only the last clear is kept

- Decided by: epic #280 orchestrator, 2026-10-26 (standing preference for the ticket, confirmed at the plan gate), not human-approved.
- Context: `clearEncounter` deleted every row of the active encounter, so a clear made by mistake could not be undone. The ticket leaves to the plan how many clears are kept and whether adding monsters after a clear still allows restoring.
- Options:
  - Chosen: a clear that finds live instances marks them removed with the clear's origin (one command id, the `cleared` event's seq as `removed_seq`) and deletes the rows removed before it, an earlier clear's set included. The set that can be restored after a clear is exactly what it cleared, and the list stays one fight long. Monsters added after the clear do not prevent restoring it; a restored monster whose name is taken gets the next free number, as in #281.
  - Keep every clear's set: the removed list would grow across fights, and "restore the encounter" would need a way to pick which clear.
  - Keep the cleared set only while nothing is added after the clear: a DM who starts adding the next fight before noticing the slip would lose the set.
- Where: `clearEncounter` in `packages/store-sqlite/src/sqlite-repository.ts`; `EncounterRepository.clearEncounter` in `packages/engine/src/encounter/repository.ts`.
- Revisit if: DMs want to restore a fight older than the last clear.
- Status: active
- Supersedes: 281.2

## 282.2 A clear that finds no live instance changes nothing but the change log

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate), not human-approved.
- Context: Under 282.1 taken literally, a second "clear it" on an empty encounter would purge the first clear's set, the only backup of the fight.
- Options:
  - Chosen: a clear of an empty encounter records the `cleared` event (as before) and purges nothing, so what can be restored stays.
  - Every clear purges what was removed before it: simpler to state, but "clear it" said twice destroys the backup, the slip this ticket exists for.
- Where: `clearEncounter` in `packages/store-sqlite/src/sqlite-repository.ts`; the `clear_encounter` reply for an empty encounter in `packages/mcp/src/tools.ts`.
- Revisit if: monsters removed one by one before an empty clear clutter the next fight's `list_encounter`.
- Status: active

## 282.3 The last clear is recorded as `encounters.cleared_seq` (migration 13) and exposed as `RemovedInstance.cleared`

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the orchestrator left the shape to the plan), not human-approved.
- Context: Restoring "the encounter" must find the instances the last clear removed and that are still removed, apart from monsters removed one by one after the clear and from cleared monsters already brought back singly.
- Options:
  - Chosen: migration 13 adds `encounters.cleared_seq`, the change-log seq of the last clear that cleared at least one instance. `listRemovedInstances` marks a removed instance `cleared` when its `removed_seq` equals it. A cleared instance restored and removed again gets a new seq and is an ordinary removal. The clear still writes `removed_source` and `removed_command_id` (281.3), so #283 can select a clear's rows by command id; #282 selects by `cleared_seq` because after a partial restore, or with removals made after the clear, the set to restore is "the last clear's rows still removed", which the seq on the encounter states directly.
  - Read the type of the event at `removed_seq` from `encounter_events`: no migration, but the store parses the log's JSON and loses the mark if the log is pruned (281.3 rejected the same for the origin).
  - A per-row flag `removed_by_clear` on `monster_instances`: a fourth column in migration 12's all-or-nothing CHECK, written by `removeInstances` and `restoreInstances` too.
  - A port method `listClearedInstances()` instead of the field: one more method in every hand-written `EncounterRepository` fake.
- Where: migration 13 (`packages/store-sqlite/src/migrations.ts`); `clearEncounter` and `listRemovedInstances` (`packages/store-sqlite/src/sqlite-repository.ts`); `RemovedInstance` (`packages/engine/src/encounter/repository.ts`).
- Status: active

## 282.4 `clearEncounter` returns the instances it cleared

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate), not human-approved.
- Context: The `clear_encounter` reply must name what was cleared.
- Options:
  - Chosen: the port's `clearEncounter` returns the cleared instances in creation order, read in the clear's transaction, like `removeInstances`.
  - The tool lists the instances before clearing: outside the clear's transaction, a GM deletion in between would be named as cleared.
- Where: `EncounterRepository.clearEncounter` (`packages/engine/src/encounter/repository.ts`); `clearEncounter` (`packages/store-sqlite/src/sqlite-repository.ts`); `clear_encounter` (`packages/mcp/src/tools.ts`).
- Status: active

## 282.5 A no-argument `restore_encounter` tool restores the last clear's set; `restore_monsters` still restores single cleared monsters

- Decided by: epic #280 orchestrator, 2026-10-26 (standing preference for the ticket), not human-approved.
- Context: "Bring them back" after a clear restores the whole set; a big fight would make one `restore_monsters` call with every name long, and the agent would need the names.
- Options:
  - Chosen: `restore_encounter` (engine `restoreEncounter`) restores every instance of the last clear still removed, in creation order, all or nothing, with the same naming and monster-type check as `restoreMonsters`; nothing left to restore is `RestoreMonstersError` `nothing_cleared`. `restore_monsters` keeps restoring single monsters by name or id, cleared ones included.
  - `restore_monsters` with every cleared name: long calls, and the names must be known.
  - A successful "Restored 0" when nothing is cleared: the agent would report success for nothing.
- Where: `restoreEncounter` and `RestoreMonstersError` (`packages/engine/src/encounter/restore.ts`); `restore_encounter` (`packages/mcp/src/tools.ts`); `.claude/skills/dm-encounter/SKILL.md` (Bringing monsters back).
- Status: active

## 282.6 `list_encounter` shows the cleared set on its own line: names up to five, a count above

- Decided by: epic #280 orchestrator, 2026-10-26 (standing preference for the ticket, wording at the plan gate), not human-approved.
- Context: With clears keeping their rows, 281.6's "Removed, can be restored" line would name every monster of a cleared fight.
- Options:
  - Chosen: the "Removed, can be restored" line names only the monsters removed one by one; a "Cleared encounter" line follows it, naming the cleared monsters when there are at most five, else giving their count, and saying `restore_encounter` brings them back. Structured content gets `cleared` beside `removed`. The table columns are unchanged (#290).
  - A count only: structured content may not reach the model, and a single-monster `restore_monsters` after a clear needs a name.
  - Every name, always: a long fight's list would be cluttered.
- Where: `listEncounterTool` (`packages/mcp/src/tools.ts`).
- Revisit if: DMs restore single monsters of big cleared fights and the count is not enough.
- Status: active

## 282.7 The e2e reseed purges the kept rows itself; a vitest test proves it

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the audit proposed cutting the test), not human-approved.
- Context: `restoreE2eSeed` clears the encounter and re-adds the same deterministic shadow ids; the rows a clear now keeps would collide with them.
- Options:
  - Chosen: the helper still calls `clearEncounter` (for the `cleared` event) and then deletes the removed rows with SQL before re-adding; `packages/owlbear/e2e/db.integration.test.ts` proves it in `npm run check`.
  - Purge rows whose ids are re-added in production `clearEncounter` or `addInstances`: production code for a test-only collision.
  - No vitest test, the e2e suite as proof (the audit's proposal): it depends on Playwright's test order within a worker and is not part of `npm run check`.
- Where: `restoreE2eSeed` (`packages/owlbear/e2e/db.ts`); `packages/owlbear/e2e/db.integration.test.ts`.
- Status: active
