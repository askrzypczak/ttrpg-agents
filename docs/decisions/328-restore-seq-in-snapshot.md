# feature: the encounter snapshot carries each restored instance's restore seq

Issue: [#328](https://github.com/askrzypczak/ttrpg-agents/issues/328). Part of Epic K ([#326](https://github.com/askrzypczak/ttrpg-agents/issues/326)). Split from [#298](https://github.com/askrzypczak/ttrpg-agents/issues/298).

## 328.1 The restore seq is a `restored_seq` column on the instance row, read through `EncounterRepository.listRestoreSeqs`

- Decided by: epic #326 orchestrator, 2026-10-31 (#298's plan gate, where it was 298.3 of the combined plan), not human-approved.
- Context: #298 needs the extension to tell a monster restored while its tab was disconnected, closed or reloaded from a GM deletion lost in flight. The maintainer widened #298 to a closed or reloaded tab (epic #326 body, 2026-10-31), so the restore's position has to reach a fresh tab through the snapshot, and nothing recorded it: `restoreInstances` cleared the removal columns and logged one `added` event, and the change log is read only by position.
- Options:
  - Chosen: migration 15 adds `monster_instances.restored_seq INTEGER` (null for older rows). `restoreInstances`, the only restore path (`restoreMonsters`, `restoreEncounter` and `undo` all call it), sets it in its transaction to the seq of the `added` event it records. `listRestoreSeqs` returns it for the active encounter's live rows that have one, so a monster removed again drops out and a later restore overwrites the value.
  - Derive it from the change log on each snapshot (each id's last `added` that is not its first): no migration, but it reads and parses a log that is never pruned on every connect. 281.1 and 281.3 already keep removal state in columns.
  - A `restoredSeq` field on `MonsterInstance`: no bridge or protocol change, but a change-log position on the domain type, carried by every `added` event and reply.
  - A method on `EncounterLog`: the log class would read the repository's table.
  - The extension sends its seq in `hello` and the bridge answers the ids restored since: `hello` goes out before the scene is ready after a reload, and one seq per connection does not fit per-scene records.
- Where: migration 15 in `packages/store-sqlite/src/migrations.ts`; `SqliteEncounterRepository.restoreInstances` and `listRestoreSeqs` in `packages/store-sqlite/src/sqlite-repository.ts`; `EncounterRepository.listRestoreSeqs` in `packages/engine/src/encounter/repository.ts`.
- Revisit if: a second restore path appears that does not go through `restoreInstances`, or the change log gets pruned or indexed by instance.
- Status: active

## 328.2 `restoreSeqs` is optional on the snapshot, read after the instances and left out when empty

- Decided by: epic #326 orchestrator, 2026-10-31 (#298's plan gate), not human-approved.
- Context: Protocol additions default so an older tab still decodes (310.7's pattern). The snapshot already reads its `seq` before the instances and leaves an empty `art` out.
- Options:
  - Chosen: `encounterSnapshotPayload.restoreSeqs`, an optional record of instance id to positive integer, with no `PROTOCOL_VERSION` change. An older extension strips the unknown key, and a newer one reads its absence from an older bridge as empty. `snapshotMessage` reads it after the instances, so every restore they reflect is listed, and leaves it out when empty, so a store with no restore sends what it always did. The two reads share no transaction, as the instances and the `seq` never did: a restore committed between them can list an id the instances do not show yet, and its `added` event, above the snapshot's `seq`, still follows.
  - A required field: an older bridge's snapshot would fail to decode in a newer extension.
  - A `PROTOCOL_VERSION` bump: refuses mixed versions for a field both sides can ignore.
- Where: `encounterSnapshotPayload` in `packages/protocol/src/protocol.ts`; `snapshotMessage` in `packages/bridge/src/encounter-bridge.ts`.
- Status: active

## 328.3 The store, port, bridge and wire part of #298 is its own ticket

- Decided by: epic #326 orchestrator, 2026-10-31 (#298's plan gate), not human-approved.
- Context: #298's combined plan touched five packages (engine, store-sqlite, bridge, protocol, owlbear), and CLAUDE.md splits such a plan into a prerequisite ticket and a feature ticket.
- Options:
  - Chosen: this ticket carries the column, the port method, the bridge payload and the protocol field; #298 keeps the extension side and is blocked by it. Nothing reads the new field until #298 lands.
  - One PR over five packages: against the rule.
  - The three-package `MonsterInstance` field, or the four-package full log scan (see 328.1): each loses on its own costs there.
- Where: #298; #328.
- Status: active
