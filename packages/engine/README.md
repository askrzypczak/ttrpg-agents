# @ttrpg-agents/engine

The domain engine: dice, monster schema and search, encounter events, map geometry, and the table port. It has no Node built-ins and imports no other workspace package; the build (`types: []`) and `eslint.config.js` enforce that.

## Monsters

- `src/monsters/schema.ts`: zod schema and the `Monster` type.
- `src/monsters/search.ts`: `searchMonsters(index, query)` (case-insensitive, plural-tolerant, ranked) and `getMonsterByKey`.
- `src/monsters/footprint.ts`: `footprintForSize(size)`, the grid cells per side a token of a size category spans (small and medium 1, large 2, huge 3, gargantuan 4, anything else 1). `addMonsters` stores it on each new instance as `footprint`.

## Encounter events

`src/encounter/types.ts` (`monsterInstanceSchema`) and `src/encounter/events.ts` (`encounterEventSchema`) are the source of truth for `MonsterInstance` and `EncounterEvent`; the protocol package reuses them as its wire payloads.

`src/encounter/origin.ts` (`changeOriginSchema`, `ChangeOrigin`): who made a change, `{source: "mcp" | "table", commandId}`. Every `EncounterRepository` mutation takes one as its last argument.

Each event carries the `origin` of the mutation that caused it. `instance-changed` covers rename, initiative, armor class and stats visibility, and carries only the fields that the mutation set. The store records every mutation's event in an ordered log readable through `EncounterLog` (`src/encounter/log.ts`); the bridge polls it and broadcasts each event as an `encounter-event` with its `seq`, and sends an `encounter-snapshot` carrying the `seq` it is current as of after each `hello-ack`.

Each instance carries `spawnPosition`: where a new token for it is created, in scene units, or null for the extension's default row; rows, events and snapshots from before it read as null.

`src/encounter/hp.ts`: the rules behind absolute HP and armor class, which the store calls: `clampHp` (current HP kept within 0..max HP), `resizeMaxHp` (max HP raised to at least 1, current HP lowered to it when above, never raised) and `clampArmorClass` (raised to at least 0). Non-integers throw `InvalidAmountError`, or `InvalidArmorClassError` for armor class.

## Test data

`@ttrpg-agents/engine/testing` (`src/testing/index.ts`) exports `makeTestInstance`, a full `MonsterInstance` for tests. It is test data only; production code must not import it (lint-enforced).

## Map

`src/map/`: pure geometry for placing monsters in rooms (image px <-> scene units <-> grid cells).

- Model (`transform.ts`): `scene = position + R(rotation) * (diag(scale) * k * (imagePx - imageOffset))`, `k = sceneDpi / imageDpi`, rotation in degrees clockwise about `position` (y down). Pixels are scaled as `(p * sceneDpi) / imageDpi` so exact corners hold. Multiples of 90 degrees use exact sine and cosine (`Math.cos(270deg)` is -1.8e-16 and would push a boundary point into the neighbouring cell).
- Cells (`cells.ts`): `sceneToCell` floors per axis (a point on a cell line is in the cell it starts); `cellCenter` is `(c + 0.5) * dpi`.
- Display grid (`display-grid.ts`): origin is the scene cell holding the map's top-left bounds corner; `cols`/`rows` are `round(boundsSize / sceneDpi)`. Labels are spreadsheet-style (`A1`, `Z10`, `AA1`; case-insensitive on parse), ranges are `T5:AB11` (a single cell `T5` is 1x1, reversed corners are normalised). Bad labels or ranges throw `InvalidCellRangeError`. `cellRangeToPolygon` and `polygonToCellRange` convert between a range and an image-px polygon; the latter returns the smallest range holding every cell centre inside the polygon, or `undefined`. `formatColumnLabel(col)` gives the column letters alone (`A`, `AF`).
- Polygons (`polygon.ts`, `rooms.ts`): a point on an edge or vertex is inside, with a tiny float tolerance. A `Room` is a name plus polygons in image px; `findRoom` ignores case and `UnknownRoomError` lists the known rooms.
- Picker (`picker.ts`): `pickFreeCells` takes the cells whose centre is inside the room and not occupied, starts at the free cell nearest the mean of all the room's cell centres, then farthest-point sampling; ties go to the first cell in scene order (rows, then columns).
- Registration (`repository.ts`, `use-map.ts`): `MapRegistration` is a map item's id, name and `MapPlacement`. The `MapRepository` port (driven) stores registrations by item id and keeps one active; registering an item again replaces its earlier registration. `useMap(table, maps, name?)` reads `sceneMap()` and registers the map: a grid that is not `SQUARE` fails with `UnsupportedGridError`; without a name the scene must have exactly one map, and with a name it takes the one map whose name matches ignoring case. Every other choice fails with `MapSelectionError`, and its message lists the maps' names; so does a map that covers less than one grid cell. Nothing is stored on failure; on success it returns the registration and the display grid's `cols` and `rows`.
- Placement (`place-monsters.ts`): `addMonstersInRooms` checks the groups, the map in use and the room names, reads `sceneMap` and `sceneTokens`, marks the cells holding a token's centre as occupied, picks free cells per group with `pickFreeCells` (each group's picks are occupied for the next), and adds the monsters with their spawn positions; monsters that do not fit get none. The result gives each placed monster's display cell and says whether the map moved. Without a room it adds like `addMonsters` and does not ask the table.

## Table

`src/table/`: `TablePort` (driven port: `sceneStatus()` asks the table, the VTT, about its scene; `sceneMap()` asks for the scene grid and the map images with their transforms; `sceneTokens()` asks for the position of each item on the table's character and mount layers, which the room placement for `add_monsters` (#50) reads to skip occupied cells; `mapImage(itemId)` asks for the gridded image of a map item, drawn as the DM sees it with the display grid's labels; all fail with `TableUnavailableError`) and `getTableStatus(repo, table)`, which adds the encounter count and the verdict: `inSync` = scene ready and token, applied and encounter counts all equal. The bridge client implements the port; `mcp` only formats the result.
