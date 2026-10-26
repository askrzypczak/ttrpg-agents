# feature: "use the current map": the agent registers the scene's map after the GM aligns it

Issue: [#184](https://github.com/askrzypczak/ttrpg-agents/issues/184).

## 184.1 The ticket is split: the table read goes first as #259

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the plan's Interfaces touched six packages (engine, protocol, owlbear, store-sqlite, bridge, mcp). CLAUDE.md splits a plan whose Interfaces touch five or more packages into a prerequisite ticket and a feature ticket at the plan gate.
- Options:
  - Chosen: split. #259 took the `scene-map` query, the extension's answer, `TablePort.sceneMap()` and the bridge client (four packages); this ticket keeps the map registration, `MapRepository` and its store, `useMap`, `use_map` and the skill (three packages). Two PRs and one more review cycle.
  - One ticket with a waiver recorded here: one PR of about 35 files, against an explicit CLAUDE.md rule.
- Where: #259; this ticket's body.
- Status: active

## 184.2 A name must match exactly one map; a name two maps share fails like several maps

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket says a name picks a map ignoring case. The GM can have two map images with the same name (the same file uploaded twice); the ticket does not say which one a shared name picks.
- Options:
  - Chosen: `useMap` fails with a `MapSelectionError` listing the maps' names, as for several maps and no name, and stores nothing; the GM renames one in Owlbear. Covered by a test.
  - The same rule written only in the plan, with no test: the branch would be untested.
  - Pick the first match: no code, but the wrong map could be registered without anyone noticing.
- Where: `useMap` (`packages/engine/src/map/use-map.ts`), `MapSelectionError` (`packages/engine/src/map/errors.ts`).
- Status: active

## 184.3 A name that matches no map fails, listing the maps; the skill calls `use_map` without a name first

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket says what happens with no name (the only map, or a failure listing several) but not with a name that matches nothing. The DM's words ("the Trollskull map") rarely equal the item name ("Trollskull Manor") exactly, and matching is exact apart from case.
- Options:
  - Chosen: an unmatched name fails with `MapSelectionError` listing the maps' names. The skill tells the agent to call `use_map` without a name; when it fails listing several maps, to call again with the listed name that matches the DM's words. Nothing is guessed in the engine.
  - Prefix or substring matching in the engine: fewer calls, but a fuzzy rule to specify and test, and a short name could still match several maps.
- Where: `useMap` (`packages/engine/src/map/use-map.ts`); "Using the map" in `.claude/skills/dm-encounter/SKILL.md`.
- Revisit if: the extra call shows up as friction in play.
- Status: active

## 184.4 The registration is stored as columns with an active flag, and re-registering updates the item's row in place

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (from the spec audit), not human-approved.
- Context: a registration is the map item id, its name and its `MapPlacement` (#49). #185 will key rooms to the map item id, and its rooms must survive a re-registration (re-registering is how the GM confirms a re-alignment).
- Options:
  - Chosen: table `map_registrations` (migration 9) with one column per placement field, CHECKs on positive sizes and dpis, and `active` 0/1 with a partial unique index, like `encounters`. `registerMap` runs in one transaction: clear the old active row, then `INSERT ... ON CONFLICT (item_id) DO UPDATE`. It never uses `INSERT OR REPLACE` or delete-then-insert, which would drop rows that cascade from the old one.
  - The placement as one JSON column: fewer columns, but no CHECKs, and a read needs parsing and validation.
  - A separate one-row table for the active map: a second table for what one flag does.
- Where: migration 9 (`packages/store-sqlite/src/migrations.ts`), `SqliteMapRepository.registerMap` (`packages/store-sqlite/src/map-repository.ts`).
- Status: active

## 184.5 The grid type is checked before the map is chosen

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: a scene can have both a grid `useMap` does not support and a map choice that fails (several maps, no name).
- Options:
  - Chosen: the grid first. A non-square scene cannot be used with any map, so the DM learns that before being asked to pick one.
  - The map first: the DM might name a map only to be told the grid is not supported.
- Where: `useMap` (`packages/engine/src/map/use-map.ts`).
- Status: active

## 184.6 The reply's column letters come from a new engine export, `formatColumnLabel`

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the `use_map` reply names the column range ("columns A-AF"); #49 had only `formatCellLabel`, which adds the row number.
- Options:
  - Chosen: `formatColumnLabel(col)` in `packages/engine/src/map/display-grid.ts`, which `formatCellLabel` now uses; the MCP formats the reply with it. #191 and #186 will draw the same edge labels.
  - Strip the digits from `formatCellLabel` in the MCP: label logic in an adapter.
  - Return a ready-made "A-AF" string from `useMap`: formatting in the use case.
- Where: `formatColumnLabel` (`packages/engine/src/map/display-grid.ts`), `use_map` (`packages/mcp/src/tools.ts`).
- Status: active

## 184.7 A map that covers less than one grid cell fails and is not registered

- Decided by: epic #92 orchestrator, 2026-10-25, review round 1 (reviewer blocker, applied), not human-approved.
- Context: the ticket says the agent validates the map before recording it. A map image that covers less than half a scene cell (a wrong upload dpi, a tiny image on the Map layer, scale 0) has a display grid of 0 x 0: it was stored as the active map and the reply read "0 x 0 cells, columns A- ...".
- Options:
  - Chosen: `useMap` fails with `MapSelectionError` naming the map and telling the GM to check its grid dpi in Owlbear, and stores nothing.
  - Accept it and guard only the reply's column range: the active map would be useless to rooms and placement.
- Where: `useMap` (`packages/engine/src/map/use-map.ts`), `MapSelectionError` (`packages/engine/src/map/errors.ts`).
- Status: active
