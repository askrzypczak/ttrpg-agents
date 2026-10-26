# feature: name rooms on the map in use by cell ranges (set, list, remove)

Issue: [#185](https://github.com/askrzypczak/ttrpg-agents/issues/185).

## 185.1 The port stores a map item's whole room list; the engine merges by name

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: rooms are added or replaced by name ignoring case, and removed by name, all or nothing. Someone has to apply the case rule and the ordering.
- Options:
  - Chosen: `MapRepository.getRooms(itemId)` and `replaceRooms(itemId, rooms)`. `setRooms` and `removeRooms` read the list, merge in the engine and write the whole list back in one transaction; the read-merge-write runs synchronously after the last `await`. The port has no change signal: #191 decides between polling `getActiveMap` and `getRooms` and adding a revision (none is added here).
  - Per-name upsert and delete in the store: the case rule moves into the adapter, and SQLite's NOCASE folds ASCII only, unlike the engine's `toLowerCase`.
- Where: `MapRepository` (`packages/engine/src/map/repository.ts`), `setRooms` and `removeRooms` (`packages/engine/src/map/room-index.ts`), `SqliteMapRepository` (`packages/store-sqlite/src/map-repository.ts`).
- Revisit if: #191 needs to know when rooms change.
- Status: active

## 185.2 Rooms are one row each in `map_rooms`, polygons as JSON, keyed to the map registration

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: a room is a name, a status and one or more image-pixel polygons of any length, keyed by the map item id, and it must survive a re-registration of the same item (184.4).
- Options:
  - Chosen: table `map_rooms` (migration 10): `map_item_id` referencing `map_registrations (item_id)` ON DELETE CASCADE, `name`, `status` (CHECK confirmed or proposed), `polygons` as JSON (CHECK `json_valid`), `position` for order, primary key (`map_item_id`, `name`). The adapter decodes each row with the engine's `savedRoomSchema`, as it does `encounter_events`. The foreign key is enforced (`openDatabase` sets `PRAGMA foreign_keys = ON`); nothing deletes a registration, which is updated in place (184.4), so the cascade never fires today and no test relies on it. `replaceRooms` deletes the item's rows and inserts the new list in one transaction; nothing references room rows.
  - A vertex table: no JSON, but a join and a row per vertex.
  - One JSON row per map: no per-room key or CHECKs.
- Where: migration 10 (`packages/store-sqlite/src/migrations.ts`), `SqliteMapRepository.getRooms` and `replaceRooms` (`packages/store-sqlite/src/map-repository.ts`), `savedRoomSchema` (`packages/engine/src/map/rooms.ts`).
- Status: active

## 185.3 "No map is in use" and "the map is no longer on the scene" are `MapSelectionError`s

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: every room use case needs the active map, and set and list need its item on the scene. Both failures tell the DM to use the map (first, or again).
- Options:
  - Chosen: reuse `MapSelectionError`, with its doc comment widened. The MCP shows any domain error's message the same way.
  - A new error class: one more export with the same handling.
- Where: `requireActiveMap` and `liveActiveMap` (`packages/engine/src/map/live-map.ts`), `MapSelectionError` (`packages/engine/src/map/errors.ts`).
- Status: active

## 185.4 `removeRooms` does not ask the table

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket reads the table's live transform for `setRooms` and `listRooms` only.
- Options:
  - Chosen: `removeRooms` needs only the active map and the saved names; it works with the bridge down.
  - Also fail when the map item is gone: one more failure mode for an operation that needs no geometry.
- Where: `removeRooms` (`packages/engine/src/map/room-index.ts`).
- Status: active

## 185.5 The map "moved" when any field of its live placement differs exactly from the registered one

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: set and list say the map moved since it was registered when the live transform differs (maintainer). The placement includes the scene grid dpi.
- Options:
  - Chosen: exact comparison of every `MapPlacement` field, scene dpi included. The values come from Owlbear and round-trip exactly through REAL columns.
  - A tolerance: a threshold to choose and test, for noise that does not occur.
- Where: `liveActiveMap` (`packages/engine/src/map/live-map.ts`).
- Revisit if: Owlbear reports float noise on an unmoved map.
- Status: active

## 185.6 Rooms keep the order they were first saved

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: `listRooms` and the unknown-room message list rooms; the ticket gives no order.
- Options:
  - Chosen: first-saved order; a replaced room keeps its place and takes the new name casing, ranges and status; new rooms are appended in call order.
  - Alphabetical: would scramble "Room 2" and "Room 10" and the order the rooms were named in prep.
- Where: `setRooms` (`packages/engine/src/map/room-index.ts`), `position` in `map_rooms`.
- Status: active

## 185.7 The active map, grid check and live placement are one internal step shared with `useMap`

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: `useMap` built the placement and checked the grid inline; set and list need the same, and #50's placement will too. Only the SQUARE grid is supported (#184).
- Options:
  - Chosen: internal `live-map.ts` (not re-exported from the engine index) with `requireActiveMap`, `requireSquareGrid`, `scenePlacement` and `liveActiveMap`; `useMap` uses the grid check and the placement builder with no change in behaviour. Set and list fail with `useMap`'s `UnsupportedGridError` when the grid is no longer square (A3).
  - Inline copies in each use case: three copies of the grid message.
- Where: `packages/engine/src/map/live-map.ts`, `useMap` (`packages/engine/src/map/use-map.ts`).
- Status: superseded by 191.2

## 185.8 Input checks run before the table is asked; the grid bounds check uses the live grid

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: a malformed range needs no table; whether a range is inside the map depends on the map's live display grid.
- Options:
  - Chosen: the active map and every input check (names, ranges parsed) first, then the table read, then each range against the live display grid. Nothing is stored unless every check passes.
  - Every check after the table read: a malformed range would need the bridge up to be reported.
- Where: `setRooms` (`packages/engine/src/map/room-index.ts`).
- Status: active

## 185.9 Room input the index cannot store fails with `InvalidRoomError`; names are not trimmed

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket makes names unique per map ignoring case but does not say what happens when one call names a room twice; a blank name or a room with no ranges would be rejected by the stored schema only on write or read.
- Options:
  - Chosen: a new `InvalidRoomError` (code `invalid_room`) for two rooms in one call whose names match ignoring case (A1), and for an empty or whitespace-only name or a room with no ranges (A2); nothing is stored. Names are stored and matched as given, case-insensitively, like map names in `use_map` (184.2, 184.3).
  - Trim names: lost, because nothing produces surrounding whitespace and the rule stays the same as the map-name rule.
  - Let the later room in the call win: a room the DM named would be dropped silently.
- Where: `InvalidRoomError` (`packages/engine/src/map/errors.ts`), `setRooms` (`packages/engine/src/map/room-index.ts`).
- Status: active

## 185.10 `setRooms` does not report which rooms it replaced

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (from the spec audit), not human-approved.
- Context: the draft plan had `setRooms` return the names of the saved rooms it replaced.
- Options:
  - Chosen: cut. The reply lists the rooms saved; nothing in #185, #50, #186 or #191 reads a replaced list.
  - Keep it: a field, a reply suffix and a test with no consumer.
- Where: `SetRoomsResult` (`packages/engine/src/map/room-index.ts`), `set_rooms` (`packages/mcp/src/tools.ts`).
- Status: active

## 185.11 `removeRooms` given the same room twice removes and reports it once

- Decided by: implementer, 2026-10-25, implementation; tested after review round 1 (reviewer suggestion, applied by the epic #92 orchestrator); not human-approved.
- Context: the plan did not say what `removeRooms(["Attic", "attic"])` does. Both names match one saved room.
- Options:
  - Chosen: remove the room once and report it once. The DM's intent is clear, and nothing is ambiguous to refuse.
  - Fail with `InvalidRoomError`, as `setRooms` does for a name given twice (A1): a refusal for a request that can only mean one thing. `setRooms` refuses because the two rooms could differ in ranges; two names to remove cannot.
  - Report the room twice: a reply that lists a room the DM did not have twice.
- Where: `removeRooms` (`packages/engine/src/map/room-index.ts`).
- Status: active
