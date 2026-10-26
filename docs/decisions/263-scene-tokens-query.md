# feature: scene-tokens query: the table reports where the tokens are

Issue: [#263](https://github.com/askrzypczak/ttrpg-agents/issues/263).

## 263.1 Token positions come from a second read-only query, `scene-tokens`, not a field on `scene-map`

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #50, split into this ticket), not human-approved.
- Context: placing monsters in a named room (#50) must skip the cells that hold a token, so it needs the positions of the items on the `CHARACTER` and `MOUNT` layers. #50 left the choice between a field on the `scene-map` result and a second query to the plan. #50's Interfaces touched six packages, so the table read was split into this ticket (five-package rule).
- Options:
  - Chosen: a second query `scene-tokens`, with `TablePort.sceneTokens()` and the bridge client method; #50's placement calls `liveActiveMap` (185.7) and `sceneTokens()` side by side. `use_map`, `set_rooms` and `list_rooms` keep reading only the map, and #189 grows the token result with item bounds without touching `scene-map`. Costs one more loopback round trip for an `add_monsters` with a room; the two reads are separate snapshots of the scene, which is harmless because the map read carries no tokens.
  - A `tokens` field on `scene-map`: one round trip, but every map read collects and ships every token, and every `TableSceneMap` fixture (engine use-map and room-index tests, mcp use-map and rooms tests) needs the field.
- Where: `querySchema`, `sceneTokensSchema`, `queryResultSchema` (`packages/protocol/src/protocol.ts`); `TablePort.sceneTokens`, `TableToken`, `TableSceneTokens` (`packages/engine/src/table/port.ts`); `handleQuery` (`packages/owlbear/src/queries.ts`); `createBridgeTable` (`packages/bridge/src/client.ts`).
- Status: active

## 263.2 Each token is reported as its position only

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #50), not human-approved.
- Context: #50 marks a cell occupied when it holds an item's centre; #189 will need each item's bounds.
- Options:
  - Chosen: `{ position }` per token, nothing else; #189 adds bounds to the same result.
  - Also the item id, layer or size: fields with no consumer in #50.
- Where: `sceneTokensSchema` (`packages/protocol/src/protocol.ts`), `TableToken` (`packages/engine/src/table/port.ts`).
- Revisit if: a consumer needs to tell our tokens from others (for example to count spawn positions whose token is not created yet, see #50's decision log).
- Status: superseded by 189.1

## 263.3 The extension keeps every item on the CHARACTER and MOUNT layers; an item's position stands for its centre

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #50), not human-approved.
- Context: #50's placement must avoid our own hidden tokens and the players' tokens alike. Owlbear reports an item's position, which is its centre only when its image grid offset is the image centre.
- Options:
  - Chosen: filter by layer only, not by our metadata or visibility, and report the position as given. Our tokens are created with the offset at the image centre, and Owlbear's default token import does the same; #189's bounds make the occupied cells exact for any item.
  - Filter to visible items, or to items that are not ours: placement would put monsters on hidden or own tokens.
  - Compute each item's centre from its image grid offset in the extension: geometry #189's bounds replace anyway.
- Where: `handleQuery` (`packages/owlbear/src/queries.ts`).
- Revisit if: tokens with an off-centre offset make placements overlap in practice before #189 lands.
- Status: superseded by 189.1
