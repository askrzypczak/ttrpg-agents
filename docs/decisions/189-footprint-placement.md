# feature: room placement uses monster footprints (Large and bigger take a block of cells)

Issue: [#189](https://github.com/askrzypczak/ttrpg-agents/issues/189).

## 189.1 `scene-tokens` reports each item's bounds from `getItemBounds`, one call per item, in place of its position

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; that the table read reports each item's bounds is the maintainer's (#189 body).
- Context: an item's position is only its centre, so a Large token on a grid intersection looked like one occupied cell, and an item whose image offset is not its centre was misplaced (263.3). The extension can ask Owlbear for an item's axis-aligned bounds; SDK 3.1.0's `OBR.scene.items.getItemBounds(ids)` returns one box around all the ids given.
- Options:
  - Chosen: each token is `{ bounds: { min, max } }` in scene units, from `getItemBounds([id])` per item on the CHARACTER and MOUNT layers, the calls run in parallel. The layer filter of 263.3 stays. Position is dropped: its only reader was the placement, which now uses the bounds. If one item's read fails (for example the item is deleted mid-read), the query answers `query-failed` like any failed read. `scene-tokens` is only on `epic-92`, so the protocol version stays 1.
  - Bounds and position both: a field with no consumer.
  - Compute the bounds in the extension from the image size, grid, scale and rotation `fromItem` already reads: no extra SDK calls, but only for images, and geometry the SDK already does.
- Where: `sceneTokensSchema` (`packages/protocol/src/protocol.ts`); `TableToken` (`packages/engine/src/table/port.ts`); `ObrAdapter.getItemBounds`, `ObrReader` (`packages/owlbear/src/obr-adapter.ts`); `ItemBounds` (`packages/owlbear/src/scene-model.ts`); `handleQuery` (`packages/owlbear/src/queries.ts`).
- Supersedes: 263.2, 263.3
- Status: active

## 189.2 A cell is occupied when its centre lies inside or on the edge of an item's bounds, or a block picked earlier in the same call covers it

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; the rule that every cell whose centre lies inside an item's bounds is occupied is the maintainer's (#189 body).
- Context: a cell centre can fall exactly on a bounds edge, for example for a one-cell token offset by half a cell, and the bounds come back from Owlbear with float noise. The spec audit pointed out that counting the edge makes a one-cell token centred on a grid corner block all four cells it touches, which is the conservative reading.
- Options:
  - Chosen: the edge counts as inside, compared with a small tolerance in cell units. There is no extra floor: an item smaller than one cell that sits on a grid line or corner holds no cell centre and blocks nothing. As in 50.5, the spawn positions of earlier calls whose tokens are not on the table yet do not count; that gap stays the maintainer's to close.
  - Also block the cell under each item's centre (#50's rule kept as a floor), so every item blocks at least one cell: one more line and test, beyond the maintainer's rule.
  - Half-open bounds: a half-offset token blocks one cell and leaves three cells it partly covers free.
  - Open bounds: a half-offset token blocks no cell.
- Where: `addMonstersInRooms` and its private occupied-cells helper (`packages/engine/src/map/place-monsters.ts`).
- Revisit if: sub-cell tokens get monsters placed on top of them in play; or overlapping placements from back-to-back adds show up in play (50.5's gap, the maintainer decides).
- Supersedes: 50.5
- Status: active

## 189.3 Groups with a room are placed largest footprint first, ties in input order; the results keep input order

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; "place the larger monsters first" is the maintainer's (#189 body).
- Context: a `RoomGroup` is one monster type, so "one Large and two Medium in a room" is two groups. A Medium group listed first could break up the only free 2 x 2 block.
- Options:
  - Chosen: every group with a room is placed in order of footprint, largest first, ties in input order. Spawn positions and `placements` stay in input and instance order, so the tool's per-group reply lines (50.8) and 50.6 (the n-th instance gets the n-th pick) are unchanged.
  - Order per room: the same result unless two rooms overlap, and more code.
- Where: `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Status: active

## 189.4 A pick is its block's cells and centre, and the picker's footprint is required

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: a pick becomes an n x n block (maintainer). The placement needs every cell of a block to mark it occupied for the next group, and its corners for the reply.
- Options:
  - Chosen: `CellPick.cells` (the block's cells in scene order, one for footprint 1) replaces `cell`; `position` is the block's centre, a grid intersection for an even footprint. `pickFreeCells` takes a required `footprint`; its one caller always passes it.
  - Keep `cell` as the block's top-left cell and let the placement derive the block: block geometry in two places.
  - An optional footprint defaulting to 1: a default that only tests would use.
- Where: `CellPick`, `pickFreeCells` (`packages/engine/src/map/picker.ts`).
- Status: active

## 189.5 A block reads as a display range in the reply; the "No free cell left" line also covers a monster that finds no block

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: `RoomPlacement.cell` is the display label `add_monsters` prints as "<Name> at <cell>" (50.8). A Large monster covers four cells.
- Options:
  - Chosen: a block is its display range from `formatCellRange` ("Ogre 1 at A1:B2"); a single cell stays "A1". A monster that finds no block is reported by the existing "No free cell left in <Room> ..." line. `add_monsters` in `packages/mcp/src/tools.ts`, its descriptions ("free cells of that saved room") and the skill's "Output after adding monsters" (relays the lines verbatim) are unchanged (spec audit check).
  - The block's top-left cell only: hides the monster's size.
  - New wording such as "No free space left": touches the tool, the skill, its evals and their tests.
- Where: `RoomPlacement.cell`, `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Status: active

## 189.6 The picker spreads first, then packs the room in scene order when the spread placed fewer blocks than asked

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the picker starts at the free spot nearest the middle of the room, then picks each next one as far as possible from those already picked (#49). With blocks that can waste space: in a 4 x 4 room the 2 x 2 block nearest the middle overlaps every other 2 x 2 block, so a second Large monster would be reported as not fitting.
- Options:
  - Chosen: when the spread order places fewer blocks than asked, a second pass takes the free blocks in scene order (first fit), and the picker returns whichever placed more. Footprint 1 never changes: the spread already places as many cells as are free.
  - The spread order only: a Large monster is reported as not fitting in a 4 x 4 room that holds two 2 x 2 blocks; its token appears in the row at the centre of the GM's view.
- Where: `pickFreeCells` (`packages/engine/src/map/picker.ts`).
- Status: active

## 189.7 The fake adapter's bounds are configured per item; neither the fake nor the e2e host gets a bounds test

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the extension's `scene-tokens` answer is tested browser-free against `createFakeObr`; the e2e fake host answers only the SDK calls the e2e tests make, and no e2e test sends `scene-tokens` (as for `scene-map`, #259).
- Options:
  - Chosen: `createFakeObr` takes `itemBounds` keyed by item id and rejects an item with none, as its `fetchImage` does. The `scene-tokens` query tests exercise it, so it has no test of its own (spec audit). The e2e fake host does not answer `getItemBounds`.
  - A default bound of one grid cell around the item's position: fewer fixture lines, geometry in the fake.
  - An e2e test of `scene-tokens` through the fake host: covers the adapter's one-line SDK call, at the cost of bounds geometry in the fake host.
- Where: `createFakeObr` (`packages/owlbear/src/fake-adapter.ts`).
- Status: active

## 189.8 The manual check in Owlbear is deferred to the epic PR

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket offers an optional manual check: a Large and a Medium monster placed in one room do not overlap. The sub-agent that works this ticket has no browser.
- Options:
  - Chosen: the check keeps the maintainer's wording and is listed as not run in this PR's body; the epic #92 orchestrator carries it into the epic PR's manual checks, as for #50 (50.11). It also shows whether Owlbear's bounds for a token include its name label.
  - Run it before this PR is integrated: needs a person with the Owlbear test room open.
- Where: this PR's body; the epic #92 PR.
- Status: active
