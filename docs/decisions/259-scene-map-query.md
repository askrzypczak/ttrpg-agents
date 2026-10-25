# feature: scene-map query: the table reports its grid and map items

Issue: [#259](https://github.com/askrzypczak/ttrpg-agents/issues/259).

## 259.1 The extension fills read-side fields on `SceneItem` for the map read, not a dedicated adapter read

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #184, split into this ticket), not human-approved.
- Context: `fromItem` in the real adapter kept only id, type, name, visibility, position and metadata, so a map item's layer, rotation, scale, image size and image grid were lost on read. The ticket left open whether to widen `SceneItem` or add a dedicated map read.
- Options:
  - Chosen: `fromItem` also copies `layer`, `rotation`, `scale` and, for `IMAGE` items, `image` and `grid`, as given (no reads below those fields, so the e2e fake host's items, which may lack them, still map); `SceneItem` gains an optional `rotation`. `handleQuery` keeps the `IMAGE` items on the `MAP` layer, so the filter is in unit-tested code and the fake needs no second copy of it.
  - A dedicated `getMapItems()` on `ObrAdapter`: `SceneItem` unchanged, but the map-layer filter would sit in the untested real adapter and be repeated in the fake.
- Where: `fromItem` (`packages/owlbear/src/obr-adapter.ts`), `SceneItem` (`packages/owlbear/src/scene-model.ts`), `handleQuery` (`packages/owlbear/src/queries.ts`).
- Revisit if: code starts comparing whole read items, where the extra fields would matter.
- Status: active

## 259.2 The grid type is a non-empty string on the wire; the engine checks it

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #184), not human-approved.
- Context: Owlbear's grid types today are `SQUARE`, `HEX_VERTICAL`, `HEX_HORIZONTAL`, `DIMETRIC` and `ISOMETRIC`; only `SQUARE` is supported by #184's `useMap` (maintainer), which must name any other type.
- Options:
  - Chosen: `z.string().min(1)` in `sceneMapSchema`, a `string` in `TableSceneMap`: a type Owlbear adds later still decodes, and `useMap` names it.
  - An enum of today's types: a new Owlbear type would make the reply fail validation, and the DM would see a decode error instead of "this grid type is not supported".
- Where: `sceneMapSchema` (`packages/protocol/src/protocol.ts`), `TableSceneMap` (`packages/engine/src/table/port.ts`).
- Status: active

## 259.3 A scene that is not ready answers `scene-map` through the existing `query-failed` path

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #184), not human-approved.
- Context: `scene-status` reports `sceneReady: false`; `scene-map` cannot read a grid without a scene.
- Options:
  - Chosen: no new path. The grid and item reads reject while no scene is loaded (the real SDK, and the fake's `whenReady`), `replyToQuery` sends a non-fatal `query-failed` with the error's message, and the bridge client raises `TableUnavailableError`.
  - A `sceneReady` field with an optional grid: more schema and branches for a case the GM fixes by opening the scene.
- Where: `handleQuery` and `replyToQuery` (`packages/owlbear/src/queries.ts`), `getGrid` in `createFakeObr` (`packages/owlbear/src/fake-adapter.ts`).
- Revisit if: the error text ("No scene found") confuses the DM in practice.
- Status: active

## 259.4 A query result for another query is a `TableUnavailableError` in the bridge client

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #184), not human-approved.
- Context: with two queries the result is a union, so each client method must narrow it by `name`. The bridge relays the extension's result without checking that it answers the query it sent.
- Options:
  - Chosen: both `sceneStatus` and `sceneMap` throw `TableUnavailableError` when the result's `name` is not their query's (a bad reply, which that error already covers).
  - Check in the bridge server: the server would have to remember each pending query's name; the client check is enough while the client is the only caller.
- Where: `createBridgeTable` (`packages/bridge/src/client.ts`).
- Status: active
