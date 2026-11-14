# feature: the active map and its rooms belong to an encounter

Issue: [#362](https://github.com/askrzypczak/ttrpg-agents/issues/362). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 362.1 The directory hands out a map repository scoped to one encounter; the map use cases do not change

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (Q1); not human-approved. The ticket left the choice to the plan.
- Context: The active map was one global row. With one encounter per scene, `use_map` in one scene must not change another scene's map, and rooms stay keyed by map item.
- Options:
  - Chosen: `EncounterDirectory.mapRepositoryFor(encounterId)` returns a `MapRepository` whose `registerMap` and `getActiveMap` act on that encounter's map. `getRooms` and `replaceRooms` stay keyed by map item, so encounters on one map share its rooms. The port keeps its four methods, and `useMap`, the room use cases, placement and the map image take the scoped repository unchanged.
  - Map accessors on the encounter-scoped `EncounterRepository`, with rooms left on a global `MapRepository`: every map use case would take two repositories.
  - A factory function on the MCP `ToolContext`: a second injection point for the same scoping, and the bridge would still need one.
- Where: `EncounterDirectory.mapRepositoryFor` in `packages/engine/src/encounter/directory.ts`; `MapRepository` in `packages/engine/src/map/repository.ts`; `SqliteMapRepository` and `SqliteEncounterDirectory.mapRepositoryFor` in `packages/store-sqlite/src`.
- Status: active

## 362.2 Each encounter records its map in `encounters.map_item_id`; migration 18 copies nothing and drops `map_registrations.active`

- Decided by: maintainer, 2026-11-11 (the column, set to null when the registration is deleted, and copying nothing: ticket body and 357.15). Dropping `active` and its index by the epic #358 orchestrator, 2026-11-13, plan gate (Q2, the spec audit's question); not human-approved.
- Context: No encounter predates migration 17 (357.15), so on a database at version 17 every encounter starts with no map. Registrations and their rooms are kept so `use_map` on a known item gets its rooms back. Nothing reads the global `active` flag after this ticket.
- Options:
  - Chosen: `ALTER TABLE encounters ADD COLUMN map_item_id TEXT REFERENCES map_registrations (item_id) ON DELETE SET NULL`, then `DROP INDEX map_registrations_one_active` and `ALTER TABLE map_registrations DROP COLUMN active`. `registerMap` upserts the registration in place (184.4's half that stays) and sets its encounter's `map_item_id` in one transaction.
  - Keep `active` and its index, unread and unwritten (the ticket's literal wording): a dead column and index.
  - An encounter id on `map_registrations`: one item could not be the map of two encounters.
  - A link table: a second table for a one-to-one value.
- Where: migration 18 in `packages/store-sqlite/src/migrations.ts`; `SqliteMapRepository.registerMap` and `getActiveMap` in `packages/store-sqlite/src/map-repository.ts`.
- Status: active
- Supersedes: 184.4

## 362.3 A tool call resolves one encounter for both its repository and its map repository

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate; not human-approved.
- Context: `use_map`, `set_rooms` and `remove_rooms` change a map and note an undo barrier (`noteCommand`). The current encounter can change while a tool waits on the table.
- Options:
  - Chosen: `ToolContext.maps` is removed. `ToolCallContext.maps` is a lazy getter beside `repo`: the first access of either resolves the call's encounter once (361.5), and both hand out repositories for that id. The undo barrier lands on the encounter whose map changed.
  - Tools call `mapRepositoryFor` themselves: the encounter is resolved twice per call, and a switch between the two reads puts the barrier on the wrong encounter.
- Where: `ToolCallContext` in `packages/mcp/src/context.ts`; `defineTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 362.4 `list_rooms` and `get_map_image` resolve the call's encounter

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate; not human-approved. A read tool on an empty store creates "Encounter 1": epic #358 orchestrator, #361 gate.
- Context: 361.5 listed `list_rooms` and `get_map_image` among the tools that never touch the encounter. They now read the encounter's map.
- Options:
  - Chosen: both read `ctx.maps`, so they resolve the call's encounter; on an empty store they create "Encounter 1" and answer "No map is in use: use the map first.". `propose_rooms` still reads nothing. This amends 361.5's tool list; 361.5 stands.
  - Read the map without resolving (no encounter means no map): a second resolution path that #363's read form would replace.
- Where: `listRoomsTool` and `getMapImageTool` in `packages/mcp/src/tools.ts`.
- Revisit if: #363 splits resolution into read and write forms.
- Status: active

## 362.5 The bridge's map-rooms poll reads the current encounter's map without creating an encounter

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate; not human-approved. The bridge learns a switch through the shared database: maintainer, 2026-11-11 (epic #358 body).
- Context: The overlay shows the rooms of the map in use. The MCP server switches the current encounter in another process.
- Options:
  - Chosen: `mapRoomsMessage` and `broadcastMapRooms` take the directory (`getCurrentEncounter`, `mapRepositoryFor`). Each tick reads the current encounter, never creating one, then its map and that item's rooms. No current encounter, or one with no map, sends `{ itemId: null, rooms: [] }`. The poll still compares payloads (191.1), so a switch to an encounter on another map is sent within one tick. `map-rooms` keeps its wire format, and `PROTOCOL_VERSION` is not bumped.
  - Resolve the encounter in the poll (create one when none is current): the bridge would create encounters on a read.
- Where: `packages/bridge/src/map-rooms.ts`, `packages/bridge/src/cli.ts`.
- Status: active

## 362.6 The `use_map` description says it sets the current encounter's map

- Decided by: work-ticket orchestrator (the #362 builder under epic #358), 2026-11-13, review round 1 (reviewer suggestion, applied over the default triage, which defers additive suggestions); not human-approved.
- Context: The agent reads tool descriptions. `use_map`'s said "makes it the active map", but it now sets only the map of the encounter the call acts on. The plan kept every reply text; a description is not a reply.
- Options:
  - Chosen: "... and makes it the current encounter's map."; one phrase in a map tool this ticket changes.
  - Leave it for #365, which adds an `encounter` parameter: the agent would read a global map until then.
- Where: `useMapTool` in `packages/mcp/src/tools.ts`.
- Revisit if: #365 lets `use_map` name an encounter.
- Status: superseded by 365.8
