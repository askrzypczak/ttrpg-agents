# feature: add monsters in a named room (the engine places them, the extension creates the tokens there)

Issue: [#50](https://github.com/askrzypczak/ttrpg-agents/issues/50).

## 50.1 The ticket is split: the table read of token positions goes first as #263

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the plan's Interfaces touched six packages. protocol, owlbear, engine and bridge carried the table read; engine, store-sqlite, mcp and owlbear carried the feature. CLAUDE.md splits a plan whose Interfaces touch five or more packages into a prerequisite ticket and a feature ticket.
- Options:
  - Chosen: split. #263 took the `scene-tokens` query, the extension's answer, `TablePort.sceneTokens()` and the bridge client (four packages). This ticket keeps the spawn position, the store migration, the placement use case, `add_monsters`, `planSync` and the skill (four packages). The cost is two PRs and one more review cycle.
  - One ticket with a waiver recorded here: one PR touching six packages, against an explicit CLAUDE.md rule.
- Where: #263; this ticket's body.
- Status: active

## 50.2 `spawnPosition` is nullable with a null default, not optional

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: a monster instance gains a spawn position in scene units. Snapshots, `added` events in the change log and store rows written before this ticket have none and must still decode.
- Options:
  - Chosen: `z.object({ x, y }).nullable().default(null)` in `monsterInstanceSchema`. Input without the field decodes as null, and the output type makes it required, so every producer must set it: the store's row mapping, `makeTestInstance`, and the hand-built test instances. That follows `initiative` and `groupId` (nullable) and `footprint` (default).
  - `.optional()`: no edits to the test literals, but a producer that forgets the field type-checks and silently drops the position.
- Where: `monsterInstanceSchema`, `NewMonsterInstance` (`packages/engine/src/encounter/types.ts`); `makeTestInstance` (`packages/engine/src/testing/index.ts`).
- Status: active

## 50.3 Placement is a new async use case around the synchronous `addMonsters`

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: placement must read the table (`sceneMap`, `sceneTokens`), which is async. `addMonsters` is synchronous and runs its store write in one transaction.
- Options:
  - Chosen: `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`) reads the table, picks the cells, then calls `addMonsters` with each group's `spawnPositions`. Positions are stored in the same transaction as the instances, in one `added` event. `addMonsters` and its callers are unchanged. With no room in any group the table is not asked, so `add_monsters` keeps working with the bridge down.
  - Make `addMonsters` itself async, with optional table and map dependencies: every existing caller and test changes.
  - Add the monsters, then write the positions: a second write and a second event, and a window in which the extension creates the tokens in the default row.
- Where: `addMonstersInRooms`, `RoomGroup`, `RoomPlacement`, `AddMonstersInRoomsResult` (`packages/engine/src/map/place-monsters.ts`); `AddMonstersGroup.spawnPositions` (`packages/engine/src/encounter/add-monsters.ts`).
- Status: active

## 50.4 Group input, then the active map and room names, then the table reads, then the store write

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: an add with a room can fail on its input (unknown monster, count, hp, initiative mode), on the stored map state (no map in use, unknown room) or at the table (bridge down, map item gone, grid not square). 185.8 put the checks that need no table before the table read.
- Options:
  - Chosen: that order. The group checks move from `addMonsters` into an internal module, `validate-add-monsters.ts`, which `encounter/index.ts` does not re-export (as `live-map.ts`, 185.7). `addMonsters` and `addMonstersInRooms` both call it. `AddMonstersError` moves with it and is re-exported by name from `add-monsters.ts`, so the package API is unchanged and there is no runtime import cycle. Every failure comes before the store write, so nothing is added.
  - Let `addMonsters` validate after the table read: no new module, but an unknown monster in a group with a room would be reported only while the bridge is up.
  - Export the validator from the package: an export whose only consumer is inside the engine (spec audit).
- Where: `validateAddMonsters` (`packages/engine/src/encounter/validate-add-monsters.ts`), `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Status: active

## 50.5 A cell is occupied when a token on the table has its centre there or the same call picked it; earlier calls' spawn positions do not count

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; the rule itself is the maintainer's (epic #92 body, 2026-10-23: "a cell is occupied if it holds an item's centre").
- Context: the occupied cells come from `scene-tokens` (#263). There is a gap: a second "add ... in the taproom" that arrives before the first batch's tokens exist on the table does not see them, and can put monsters on the same cells. The gap is normally the extension's reconcile delay (the bridge polls the change log every 250 ms). It is longer while the extension waits for the GM to pick art for a monster type that has none (`encounter-sync.ts`, the `needsArt` loop), because tokens are created only after the pick. A closed GM tab cannot cause it: placement then fails, because the table cannot be read.
- Options:
  - Chosen: the maintainer's rule as written. A cell is occupied if it holds the centre of an item on the CHARACTER or MOUNT layer, or if a group earlier in the same call picked it. If an overlap happens, the GM drags the tokens apart.
  - Also count the stored spawn positions of every instance in the active encounter: no change to #263's query. The cost is that a cell stays blocked after the GM moves a token away from it, so a room looks fuller than it is and monsters may be reported unplaced while there is space.
  - Count only the stored spawn positions whose token is not on the table yet: exact. It needs #263's result to report the instance id of our own tokens (revisit 263.2) and the engine to read the encounter during placement.
- Where: `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Revisit if: overlapping placements show up in play (the maintainer decides; both alternatives extend the maintainer's rule).
- Status: superseded by 189.2

## 50.6 A group that does not fit leaves its last instances unplaced

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: when a room has fewer free cells than the group has monsters, every monster is still added (maintainer), and some get no spawn position.
- Options:
  - Chosen: the group's n-th instance gets the picker's n-th cell. The instances past the last pick (the highest numbers) are unplaced and appear in the default row, and the result lists them. The first pick is nearest the middle of the room (#49's picker), so "Shadow 1" is central.
  - Spread the unplaced ones through the group: no reason to prefer any one monster, and harder to read in the reply.
- Where: `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`), `AddMonstersGroup.spawnPositions` (`packages/engine/src/encounter/add-monsters.ts`).
- Status: active

## 50.7 The default row holds only the new tokens without a spawn position

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: `planSync` placed every new token in a row at the viewport centre, each in a slot as wide as its footprint.
- Options:
  - Chosen: a new token with a spawn position is created there. The row is built from the other new tokens only, so it stays compact and centred. An existing token is never moved (position stays create-only).
  - Keep every new token's slot in the row and leave the placed ones' slots empty: a row with gaps for no reason.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active in part: its row clause is superseded by 306.4 (the row also holds a token moved back with no previous position recorded)

## 50.8 The reply has one "Placed in <Room>" line and one "No free cell left" line per group with a room

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket asks the reply to give each placed monster's display cell (for example "Shadow 1: T6") and to say which monsters did not fit.
- Options:
  - Chosen: after the table, for each group with a room, `Placed in <Room>: <Name> at <cell>, ...` when any monster was placed, and `No free cell left in <Room> for <Name>, ...: their tokens appear in a row at the centre of the GM's view.` ("its token appears" for one) when any was not. Then the moved line from `set_rooms` and `list_rooms` when the map moved, then the rolls. The cell labels come from the engine (`RoomPlacement.cell`). The structured content adds `placements` and `moved`. The tool tells consecutive placements of different groups apart by each instance's group id, so two groups in one room get their own lines; the implementer chose this over grouping by room name, which would merge them. It relies on each group getting its own id (`newGroupId`, random UUIDs in the MCP server); splitting the placements by the input groups' counts would not, but puts that mapping in the adapter. A test with two groups in one room pins the per-group lines (reviewer, round 1).
  - A cell column in the table: an empty cell for every monster without a room, and the unplaced ones still need a line.
- Where: `add_monsters` (`packages/mcp/src/tools.ts`); "Output after adding monsters" in `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 50.9 The "rooms" eval state names the Attic as A1:B2

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the too-small eval row needs a room with a known, small number of cells. The "rooms" state named the Attic without a range.
- Options:
  - Chosen: the Attic is A1:B2 (4 cells); "add 6 shadows in the attic" places 4 and reports 2. The rows that already use the "rooms" state are unaffected.
  - A new state with a closet: one more state to set up for one row.
- Where: `.claude/skills/dm-encounter/EVALS.md`.
- Status: active

## 50.10 The spawn position is stored as two REAL columns, both NULL or both set

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the store keeps each instance's spawn position so that a snapshot after a restart still creates a not-yet-created token in its room.
- Options:
  - Chosen: migration 11 adds `spawn_x REAL` and `spawn_y REAL` to `monster_instances`, with a CHECK that both are NULL or both are set. SQLite accepts the cross-column CHECK on `ADD COLUMN`. Older rows read as no position. This follows the column-per-field registrations (184.4).
  - One JSON column: no CHECK, and a parse and validation on every read.
- Where: migration 11 (`packages/store-sqlite/src/migrations.ts`), `SqliteEncounterRepository` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Status: active

## 50.11 The manual check in Owlbear is deferred to the epic PR

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket asks for a manual check recorded in the PR: on the test map with rooms named, "add 5 shadows in the taproom" puts 5 hidden tokens inside the Taproom, and they are still there after a reload. The sub-agent that works this ticket has no browser. The spec audit noted that the maintainer wrote this criterion.
- Options:
  - Chosen: the check keeps the maintainer's wording and is listed as not run in this PR's body. The epic #92 orchestrator carries it into the epic PR's list of manual checks, for the maintainer to run before merging.
  - Run it before this PR is integrated: needs a person with the Owlbear test room open.
- Where: this PR's body; the epic #92 PR.
- Status: active
