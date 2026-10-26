# feature: bring back monsters removed by mistake

Issue: [#281](https://github.com/askrzypczak/ttrpg-agents/issues/281). Part of Epic J ([#280](https://github.com/askrzypczak/ttrpg-agents/issues/280)).

## 281.1 A removed instance stays in `monster_instances`, marked removed, instead of moving to a removed-instances table

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the orchestrator left the shape to the plan), not human-approved.
- Context: `removeInstances` deleted the row, so a monster removed by mistake could not come back with its id and state. The epic's standing decision asks for storage that #282 (restore after a clear) and #283 (undo) build on.
- Options:
  - Chosen: soft delete. Migration 12 adds `removed_seq` (the change-log `seq` of the instance's `removed` event), `removed_source` and `removed_command_id`, all NULL (in the encounter) or all set (CHECK). `ACTIVE_SCOPE` and `listInstances` filter removed rows, so every per-id mutation treats a removed instance as unknown. The row keeps its id and rowid, so a restored instance sorts back at its creation position.
  - A removed-instances table the row moves to and back: a second table that has to mirror every future column of `monster_instances`, and a restored row gets a new rowid (it would sort after instances created in the same millisecond).
  - A JSON copy of the instance in a side table: duplicates the row, and an unparseable copy (a newer schema) would need its own handling.
- Where: `migrations.ts` (migration 12), `ACTIVE_SCOPE`, `removeInstances`, `listRemovedInstances`, `restoreInstances` and `listInstances` in `packages/store-sqlite/src/sqlite-repository.ts`; `RemovedInstance`, `RestoreNamer` and the two port methods in `packages/engine/src/encounter/repository.ts`.
- Revisit if: a query of live instances forgets the removed filter, or removed rows grow large enough to slow the per-id lookups.
- Status: active

## 281.2 Removed instances are kept until the encounter is cleared

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the orchestrator left retention to the plan), not human-approved.
- Context: Removed rows need a retention rule. There is one active encounter and no "replace the encounter" operation; `clear_encounter` ends a fight.
- Options:
  - Chosen: `clearEncounter` keeps deleting every row of the active encounter, live and removed, so one fight's removals stay restorable and the list of what can be restored stays one fight long. The e2e reseed (`restoreE2eSeed`, which clears and re-adds the same ids) keeps working. #282 changes `clearEncounter` to keep its own cleared set.
  - Keep the cleared set now too: part of #282's work, and the e2e reseed would hit the primary key of the kept rows.
  - A cap of the last N removals: an arbitrary number, and a fight with many removals would lose the oldest.
  - Keep forever: the listing in `list_encounter` would grow across fights.
- Where: `clearEncounter` and `listRemovedInstances` in `packages/store-sqlite/src/sqlite-repository.ts`; `docs/architecture.md` (Shared database).
- Revisit if: #282 keeps cleared sets, or DMs want to restore a monster removed before the last clear.
- Status: superseded by 282.1

## 281.3 The removal's origin (source and command id) is stored with the removed state

- Decided by: epic #280 orchestrator, 2026-10-26 (standing decision for the epic, and plan-gate answer on the columns), not human-approved.
- Context: #282 restores the set removed by one `clearEncounter` and #283 reverses one MCP command, so both select removed instances by the removing command. The `removed` event at `removed_seq` already carries the origin.
- Options:
  - Chosen: two columns, `removed_source` and `removed_command_id`, beside `removed_seq`, exposed as `RemovedInstance.removedBy`. #282 and #283 select by command id without parsing the log, and the removed state stays readable if the change log is ever pruned (206.1 "Revisit if").
  - Read the origin from the `removed` event at `removed_seq`: two fewer columns, but the store joins `encounter_events` and parses its JSON, and the state is lost if the log is pruned.
  - Add the origin in #283 with another migration: removals made before it would have none.
- Where: migration 12 (`packages/store-sqlite/src/migrations.ts`); `removeInstances` and `listRemovedInstances` (`packages/store-sqlite/src/sqlite-repository.ts`); `RemovedInstance` (`packages/engine/src/encounter/repository.ts`).
- Revisit if: #282 and #283 land without reading `removedBy`.
- Status: active

## 281.4 A restored token is created at the instance's stored spawn position, or in the default row

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the ticket left it to the plan), not human-approved.
- Context: Restoring emits an `added` event for the same id, and the extension creates a new token for it. Under "Who owns what" the table owns a token's position after creation and the store never learns it.
- Options:
  - Chosen: the token is created where any new token is: at the instance's `spawnPosition` when it has one, else in the default row. No "Who owns what" row changes and no extension change.
  - The token's last position on the table: the store does not have it; writing it back would be a new synced value with its own row and write-back.
  - Pick a new free cell in the instance's room: the room is not stored with the instance, and placement needs the table (`sceneTokens`).
- Where: `restoreInstances` (`packages/store-sqlite/src/sqlite-repository.ts`), which keeps `spawn_x`/`spawn_y`; `fold` and `apply` in `packages/owlbear/src/encounter-sync.ts` (unchanged); `docs/architecture.md` ("Deleted tokens stay deleted").
- Revisit if: DMs expect a restored token where it last stood.
- Status: active

## 281.5 Accept the race where a restore right after a GM token deletion is removed again; fix it in a follow-up

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate, question raised by the spec audit), not human-approved.
- Context: The extension keeps a GM-deleted id in `placed` until it reconciles after the store's `removed` answer. If the restore's `added` event folds into that same reconcile, the extension reports the restored token as deleted again, and the store removes the monster again after the agent replied "Restored", with no note to the GM.
- Options:
  - Chosen: accept it as a known limitation and file #291 for the extension fix (forget an id from `placed` when its `removed` event is folded), sequenced after #277. Rare: a restore is an agent command, usually seconds after the deletion.
  - Fix it here in `packages/owlbear/src/encounter-sync.ts`: #277 changes that file in parallel, so the edits would conflict.
  - Accept it with no ticket: leaves a silent removal unrecorded.
- Where: `apply` in `packages/owlbear/src/encounter-sync.ts` (unchanged here); #291.
- Revisit if: #291 lands, or a GM hits the race.
- Status: superseded by 291.1

## 281.6 The DM sees what can be restored in `list_encounter`

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the ticket offered `list_encounter` or the tool's own reply), not human-approved.
- Context: The DM needs a way to see which removed monsters can come back.
- Options:
  - Chosen: `list_encounter` appends a "Removed, can be restored" line (newest removal first) after its table, also when the encounter is empty, and `removed` in its structured content.
  - A new read-only tool: one more tool in the model's context for a rare question.
  - Only the restore tool's failure reply: "what did I remove?" would need a failing write.
- Where: `listEncounterTool` (`packages/mcp/src/tools.ts`); `.claude/skills/dm-encounter/SKILL.md` (Bringing monsters back).
- Revisit if: the line clutters long fights.
- Status: active

## 281.7 Restore errors: `not_removed` for a monster still in the encounter, `unknown_monster` for a type missing from the index, `TargetError` otherwise

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate), not human-approved.
- Context: The ticket asks for a typed domain error for an unknown or not-removed monster. Renaming a restored monster through the naming strategy needs its `Monster` from the index.
- Options:
  - Chosen: `RestoreMonstersError` with codes `not_removed` (the target names only a live instance) and `unknown_monster` (checked for every target before any write); unknown or ambiguous targets keep the existing `TargetError`.
  - `TargetError` for a live target too: its "Unknown target" message would mislead the agent about a monster it can see in the encounter.
  - A plain `Error` for a missing type: it would surface as a protocol error, not a tool error.
- Where: `RestoreMonstersError` and `restoreMonsters` (`packages/engine/src/encounter/restore.ts`); `restore_monsters` (`packages/mcp/src/tools.ts`).
- Status: active

## 281.8 AC7: the restore tool and the listing get their own acceptance criterion

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate, proposed by the spec audit), not human-approved.
- Context: The ticket's Proposed change asks for "a tool to restore monsters, and a way to see what can be restored", but no ticket AC made them checkable (AC5 covers only the README and the skill).
- Options:
  - Chosen: add AC7 (`restore_monsters` restores by id or name, all or nothing, and replies with each restored monster and its old name when renamed; `list_encounter` names the removed monsters, newest removal first; MCP integration tests). It adds no behaviour beyond the Proposed change.
  - Strike it and map the MCP tests to AC5: the tool's behaviour would have no criterion of its own.
- Where: `packages/mcp/src/tools-restore.integration.test.ts`.
- Status: active
