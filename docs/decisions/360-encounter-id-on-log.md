# feature: the encounter id on change-log rows, events and snapshots

Issue: [#360](https://github.com/askrzypczak/ttrpg-agents/issues/360). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 360.1 The encounter id is a nullable `encounter_events.encounter_id` column (migration 16), with no backfill, foreign key or index

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate; migration number from the epic brief), not human-approved. Null on old rows follows 357.15 (maintainer, 2026-11-11).
- Context: #361 undoes and filters one encounter's events, #364 applies only the held encounter's events, and Epic O logs art events that belong to no encounter. The change log recorded no encounter. 357.15 keeps change-log rows when #361 deletes encounters.
- Options:
  - Chosen: migration 16, `ALTER TABLE encounter_events ADD COLUMN encounter_id TEXT;`. Rows from before it read null ("belongs to no encounter"). No foreign key, because rows outlive their encounter by design (357.15); no index, because #361 reads the column within a `seq` range, which the primary key already serves.
  - The id inside the event JSON: no migration, but #361 filters by encounter in SQL, and 281.3 and 282.3 already rejected parsing the log's JSON in queries.
  - A foreign key to `encounters`: #361's deletion of every encounter would have to delete or null the log rows, and `seq` must never go backwards.
- Where: migration 16 in `packages/store-sqlite/src/migrations.ts`; `SqliteEncounterLog.eventsSince` in `packages/store-sqlite/src/sqlite-log.ts`; `LoggedEvent.encounterId` in `packages/engine/src/encounter/log.ts`.
- Revisit if: the change log gets pruned per encounter, or a query reads it by encounter across the whole log.
- Status: active

## 360.2 The repository logs the active encounter's id, creating the encounter on a clear or empty restore of an empty store

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate, Q3), not human-approved.
- Context: Every `SqliteEncounterRepository` mutation acts on the active encounter, but `clearEncounter` (and `restoreInstances([])`) on a store with no encounter had none to name. Null on the wire means "applies whatever encounter is held" (#364, epic brief).
- Options:
  - Chosen: the private `record` reads the id through `getOrCreateActiveEncounter()` inside the mutation's transaction, so an empty clear creates the active encounter row first. No event the repository writes is ever null; null stays for rows from before migration 16 and Epic O's art events. #361 replaces the lookup with the scoped repository's own id.
  - Log null for the empty clear: #364 would apply that `cleared` to whatever encounter the tab holds and clear it.
  - Log nothing for an empty clear: changes 282.2 (a clear that finds no live instance still writes the change log).
- Where: `record` in `packages/store-sqlite/src/sqlite-repository.ts`.
- Revisit if: #361's scoped repository lands (it carries its own encounter id).
- Status: superseded by 361.4

## 360.3 The snapshot reads the active encounter through a new engine interface `ActiveEncounterReader`

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate, Q1, option B, the spec auditor's verdict), not human-approved. Rejecting option C was the planner's call under CLAUDE.md Architecture.
- Context: `snapshotMessage` must name the active encounter, or null when none exists, and must not create one on every client connect. No port method read the active encounter without creating it, and the instances cannot name an empty encounter.
- Options:
  - Chosen: `ActiveEncounterReader { getActiveEncounter(): Encounter | undefined }` in the engine, implemented by `SqliteEncounterRepository`, consumed by `snapshotMessage(repo: EncounterRepository & ActiveEncounterReader, ...)`. It is not part of `EncounterRepository`, so no test fake changes. The read sits after the instances and before the restore seqs: an encounter created between the reads gives an empty snapshot that names it, never instances under a null id.
  - (A) The method on `EncounterRepository`: a stub in nine test fakes across engine, mcp and bridge and an `events-origin` exclusion, all moved again by #361.
  - (C) A closure wired in `cli.ts`: no engine change, but the bridge would read the store outside the engine's ports.
- Where: `packages/engine/src/encounter/repository.ts` and `encounter/index.ts`; `getActiveEncounter` in `packages/store-sqlite/src/sqlite-repository.ts`; `snapshotMessage` in `packages/bridge/src/encounter-bridge.ts`.
- Revisit if: #361's directory port absorbs, extends or replaces the interface (its plan says which).
- Status: superseded by 361.3

## 360.4 Both wire fields are required and nullable, with no `PROTOCOL_VERSION` bump

- Decided by: epic #358 orchestrator, 2026-11-13 (plan gate; AC4 of the ticket and the brief's protocol convention), not human-approved.
- Context: AC4 asks `decodeMessage` to reject an `encounter-event` or `encounter-snapshot` without `encounterId`. 328.2 made `restoreSeqs` optional and rejected "a required field: an older bridge's snapshot would fail to decode in a newer extension".
- Options:
  - Chosen: `encounterId: z.string().nullable()`, required, on both payloads, with no version bump. An older open tab strips the unknown key. The bridge serves the extension, so both ship as one build; a tab built with this change, talking to a bridge process started before it, drops these two messages (`reconnecting-socket.ts` ignores an undecodable message) until the bridge restarts. That risk is accepted because the ticket's AC4 requires the field, and the window closes when the bridge restarts. 328.2's chosen option stands.
  - Optional fields: no fixture churn and an older bridge still decodes, but AC4 rules it out.
  - A `PROTOCOL_VERSION` bump: refuses mixed versions; the brief bumps only when a receiver would reject the other side's message, and an older tab does not.
- Where: `encounterEventPayload` and `encounterSnapshotPayload` in `packages/protocol/src/protocol.ts`; `broadcastLogEvents` and `snapshotMessage` in `packages/bridge/src/encounter-bridge.ts`.
- Status: active
