# feature: show the map grid labels and room outlines on the table (local overlay)

Issue: [#191](https://github.com/askrzypczak/ttrpg-agents/issues/191).

## 191.1 The bridge polls the active map and its rooms; the port gets no change signal

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the bridge pushes the active map's rooms to the extension on change, but the MCP server writes them in another process, and `MapRepository` has no change signal. 185.1 left the choice between polling and a revision to this ticket.
- Options:
  - Chosen: `broadcastMapRooms` reads `getActiveMap` and `getRooms` every 250 ms, the encounter log poller's interval. It broadcasts `map-rooms` when the encoded payload differs from the last one sent; the first comparison is against the state read when polling starts. A failed read is retried on the next tick. There is no port change and no migration.
  - A revision in the port and the store: a `MapRepository` method plus a migration, which would make `store-sqlite` a fifth changed package. It would save two small reads per tick.
- Where: `broadcastMapRooms` (`packages/bridge/src/map-rooms.ts`), `packages/bridge/src/cli.ts`.
- Revisit if: the room list grows large enough that a read every 250 ms shows up in the bridge's CPU use.
- Status: active

## 191.2 The engine exports `scenePlacement`; the extension converts the map item through it

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Supersedes: 185.7 (only its "not re-exported" part).
- Context: the overlay needs the map item's live `MapPlacement`. The engine builds it in `scenePlacement`, which 185.7 kept internal. The extension's `mapItemOf` (`queries.ts`, private) also builds the table's view of a map item. If a copy of the conversion drifted, the overlay would not match the cells the engine resolves.
- Options:
  - Chosen: re-export `scenePlacement`, and only it, from `packages/engine/src/map/index.ts`. `requireActiveMap`, `requireSquareGrid` and `liveActiveMap` stay internal, and `live-map.ts` does not move. The extension's `mapPlacementOf` checks for an IMAGE on the MAP layer with image and grid specs (one line, not worth sharing with `mapItemOf`), builds the `TableMapItem` shape and calls the engine. The engine owns every number.
  - A copy of the conversion in the extension, pinned to the engine by a test, with a follow-up to unify it: no engine change, but two conversions to keep in step.
- Where: `packages/engine/src/map/index.ts`, `scenePlacement` (`packages/engine/src/map/live-map.ts`), `mapPlacementOf` (`packages/owlbear/src/overlay-plan.ts`).
- Status: active

## 191.3 A failed rooms read for the push after `hello-ack` is logged by the bridge, and nothing is sent

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (from the spec audit), not human-approved.
- Context: the bridge sends `map-rooms` right after the encounter snapshot that follows each `hello-ack`. For a throwing snapshot, the server sends a non-fatal `snapshot-failed` error without an id.
- Options:
  - Chosen: the server logs the failure with `console.error` and sends nothing. The `hello-ack`, the snapshot and the socket are unaffected. The overlay stays empty until the rooms or the active map change, or the extension reconnects.
  - A non-fatal `map-rooms-failed` error, shown in the panel: nothing in the extension reads a non-fatal error without an id, so it would need a new consumer.
- Where: `BridgeServerOptions.mapRooms` (`packages/bridge/src/server.ts`).
- Revisit if: the DM sees an empty overlay with no explanation in practice.
- Status: active
