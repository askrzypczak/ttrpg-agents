# @ttrpg-agents/engine

The domain engine: dice, monster schema and search, encounter events, map geometry, and the table port. It has no Node built-ins and imports no other workspace package; the build (`types: []`) and `eslint.config.js` enforce that.

## Monsters

- `src/monsters/schema.ts`: zod schema and the `Monster` type.
- `src/monsters/search.ts`: `searchMonsters(index, query)` (case-insensitive, plural-tolerant, ranked) and `getMonsterByKey`.

## Encounter events

`src/encounter/types.ts` (`monsterInstanceSchema`) and `src/encounter/events.ts` (`encounterEventSchema`) are the source of truth for `MonsterInstance` and `EncounterEvent`; the protocol package reuses them as its wire payloads.

`src/encounter/events.ts`: `observeRepository(repo, emitter)` wraps an `EncounterRepository` and emits `added`, `removed`, `cleared` and `hp-changed` after each successful mutation (not on throws; `removeInstances` emits one `removed` per id; `setHp` and `setMaxHp` emit `hp-changed`). `renameInstance`, `setInitiative` and `setArmorClass` emit no event: renames, initiative and armor class changes reach the bridge by snapshot only. Subscribe through `EncounterEvents.subscribe(listener)`, which returns an unsubscribe function. The engine knows nothing about Owlbear; the bridge sends an `encounter-snapshot` after each `hello-ack` and whenever the database changes (polling `PRAGMA data_version`), and no longer forwards events from the observed repository (the `encounter-event` message type remains in the protocol).

`src/encounter/hp.ts`: the rules behind absolute HP and armor class, which the store calls: `clampHp` (current HP kept within 0..max HP), `resizeMaxHp` (max HP raised to at least 1, current HP lowered to it when above, never raised) and `clampArmorClass` (raised to at least 0). Non-integers throw `InvalidAmountError`, or `InvalidArmorClassError` for armor class.

## Test data

`@ttrpg-agents/engine/testing` (`src/testing/index.ts`) exports `makeTestInstance`, a full `MonsterInstance` for tests. It is test data only; production code must not import it (lint-enforced).

## Map

`src/map/`: pure geometry for placing monsters in rooms (image px <-> scene units <-> grid cells).

- Model (`transform.ts`): `scene = position + R(rotation) * (diag(scale) * k * (imagePx - imageOffset))`, `k = sceneDpi / imageDpi`, rotation in degrees clockwise about `position` (y down). Pixels are scaled as `(p * sceneDpi) / imageDpi` so exact corners hold. Multiples of 90 degrees use exact sine and cosine (`Math.cos(270deg)` is -1.8e-16 and would push a boundary point into the neighbouring cell).
- Cells (`cells.ts`): `sceneToCell` floors per axis (a point on a cell line is in the cell it starts); `cellCenter` is `(c + 0.5) * dpi`.
- Display grid (`display-grid.ts`): origin is the scene cell holding the map's top-left bounds corner; `cols`/`rows` are `round(boundsSize / sceneDpi)`. Labels are spreadsheet-style (`A1`, `Z10`, `AA1`; case-insensitive on parse), ranges are `T5:AB11` (a single cell `T5` is 1x1, reversed corners are normalised). Bad labels or ranges throw `InvalidCellRangeError`. `cellRangeToPolygon` and `polygonToCellRange` convert between a range and an image-px polygon; the latter returns the smallest range holding every cell centre inside the polygon, or `undefined`.
- Polygons (`polygon.ts`, `rooms.ts`): a point on an edge or vertex is inside, with a tiny float tolerance. A `Room` is a name plus polygons in image px; `findRoom` ignores case and `UnknownRoomError` lists the known rooms.
- Picker (`picker.ts`): `pickFreeCells` takes the cells whose centre is inside the room and not occupied, starts at the free cell nearest the mean of all the room's cell centres, then farthest-point sampling; ties go to the first cell in scene order (rows, then columns).

## Table

`src/table/`: `TablePort` (driven port: `sceneStatus()` asks the table, the VTT, about its scene; fails with `TableUnavailableError`) and `getTableStatus(repo, table)`, which adds the encounter count and the verdict: `inSync` = scene ready and token, applied and encounter counts all equal. The bridge client implements the port; `mcp` only formats the result.
