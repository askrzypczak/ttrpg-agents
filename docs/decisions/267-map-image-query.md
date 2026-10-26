# feature: map-image query: the table sends a gridded image of the map

Issue: [#267](https://github.com/askrzypczak/ttrpg-agents/issues/267).

## 267.1 #186 is split: the table read of the map image goes first as this ticket

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (of #186, split into this ticket), not human-approved.
- Context: #186's plan touched six packages in its Interfaces (protocol, owlbear, engine, bridge, mcp, and the skill). CLAUDE.md splits a plan whose Interfaces touch five or more packages into a prerequisite ticket and a feature ticket.
- Options:
  - Chosen: split. This ticket takes the `map-image` query, the extension's gridded render and encode, `TablePort.mapImage` and the bridge client and timeout (four packages). #186 keeps `getMapImage`, `proposeRooms`, the MCP image block and tools, and the skill (two packages). The cost is two PRs and one more review cycle, as for 184.1 and 50.1.
  - One ticket with a waiver recorded here: one PR touching six packages, against an explicit CLAUDE.md rule.
- Where: this ticket; #186's body.
- Status: active

## 267.2 The bridge waits 30 s for a `map-image` reply; there is no image cache

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; the choice between a longer timeout and a cache was left to the plan by the maintainer (#186).
- Context: the bridge waits 5 s for any query reply. Spike #45 measured about 3 s to fetch a 1 MB map image from the Owlbear CDN in the extension iframe, before any drawing or encoding.
- Options:
  - Chosen: a new `mapImageTimeoutMs` option (default 30 000 ms) that `sendQuery` uses for `map-image` only; every other query keeps `queryTimeoutMs` (5 s), so a closed GM tab is still reported in 5 s for them.
  - A per-map-and-transform cache in the extension: does not help the first call, which is the slow one, and needs invalidation when the map moves or its image changes.
  - One longer timeout for every query: a dead tab would be reported 30 s late by every tool.
- Where: `BridgeServerOptions.mapImageTimeoutMs`, `sendQuery` (`packages/bridge/src/server.ts`).
- Revisit if: a real map takes longer than 30 s on the GM's connection.
- Status: active

## 267.3 The image byte budget derives from one wire constant, `MAX_MESSAGE_BYTES`

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the bridge's WebSocket accepts messages of at most 1 MiB; a larger reply makes it close the GM tab's socket instead of answering. The image travels as base64 inside a `query-result` envelope.
- Options:
  - Chosen: protocol exports `MAX_MESSAGE_BYTES` (1 MiB). The bridge's `maxPayload` uses it, and the extension's `MAP_IMAGE_MAX_BYTES` is `floor((MAX_MESSAGE_BYTES - 4096) / 4) * 3` (783 360 bytes), so the base64 data plus the envelope stays under the cap. A test encodes a reply of that size and checks it.
  - A literal in each package with a comment: the two could drift, and the failure (a closed socket) is far from its cause.
- Where: `MAX_MESSAGE_BYTES` (`packages/protocol/src/protocol.ts`), `maxPayload` (`packages/bridge/src/server.ts`), `MAP_IMAGE_MAX_BYTES` (`packages/owlbear/src/map-image.ts`).
- Status: active

## 267.4 The image is drawn from fetched bytes through an image bitmap, so the canvas cannot be tainted

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: #186 asked to check first that a canvas holding the cross-origin CDN image can be exported: a canvas tainted by a cross-origin image refuses to export. The sub-agent that works this ticket has no browser and cannot reach the real CDN.
- Options:
  - Chosen: fetch the bytes (`ObrAdapter.fetchImage`, which spike #45 proved works from the extension iframe), make a Blob, `createImageBitmap`, draw on an `OffscreenCanvas`, `convertToBlob`. A bitmap made from a fetched Blob is origin-clean, so the risk is resolved by construction. The canvas code is one branch-free browser-only function; an e2e test runs it in Chromium with the image served cross-origin with CORS, as the CDN does. The check against the real CDN is a manual check, not run here, carried to the epic #92 PR.
  - Draw an `<img>` loaded from the CDN URL: taints the canvas unless the CDN sends CORS headers and the image is loaded with `crossOrigin`, which only a real-CDN run can show.
  - Stop and wait for a manual check before building: needs a person with the Owlbear test room open.
- Where: `drawMapImageOnCanvas` (`packages/owlbear/src/map-image-canvas.ts`), the `map-image` case of `handleQuery` (`packages/owlbear/src/queries.ts`), `packages/owlbear/e2e/map-image.e2e.ts`.
- Revisit if: the manual check on the real CDN fails.
- Status: active

## 267.5 The image is the display grid plus a one-cell margin, labelled on all four edges, with whole-pixel cells

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; the downscale target (a long side of at most 1600 px) is the maintainer's example (#186).
- Context: the agent reads cells from the drawn labels; spike #45 found 24 of 24 correct picks with lettered columns and numbered rows baked into the image. The image must show the map as the DM sees it.
- Options:
  - Chosen: the engine's `displayGrid` plus a one-cell margin on every side; column letters (`formatColumnLabel`) at top and bottom and row numbers at left and right, centred on their column or row; cell lines on every display cell boundary; the map under the affine transform from the engine's `mapTransform`, clipped to the grid. Cells are whole pixels, `floor(1600 / (max(cols, rows) + 2))` (Trollskull: 47 px, 1598 x 1222). No cap on upscaling: a small map is drawn with larger cells.
  - Labels on the top and left only, as the #191 overlay draws them: far cells would need counting across the whole map.
  - No cell lines: the agent would estimate cell boundaries from the edge labels.
  - Cap the scale at the source resolution: one more rule for no gain in reading.
- Where: `planMapImage` (`packages/owlbear/src/map-image.ts`).
- Status: active

## 267.6 WEBP, or JPEG when the browser cannot encode WEBP, at decreasing quality until it fits

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; WEBP or JPEG is the maintainer's (#186).
- Context: the encoded image must fit `MAP_IMAGE_MAX_BYTES`. Browsers without WEBP encoding (Safari) answer PNG when asked for WEBP.
- Options:
  - Chosen: for quality 0.85, then 0.7, then 0.5, ask for `image/webp`, and when the browser answers another type, ask for `image/jpeg` at the same quality; return the first result within the budget. When none fits, fail, so the reply is `query-failed`. The choice is in pure, unit-tested code; the canvas only converts. Only Chrome has been exercised (by the e2e test); the fallback is untested in a real Safari, and whether Safari is a supported GM browser is the maintainer's call.
  - WEBP only: cuts a branch and the `image/jpeg` mime type, but a Safari GM tab would send PNG under a WEBP label or fail.
  - Also shrink the image when the lowest quality is over budget: another loop for a case not seen at 1600 px.
- Where: `encodeWithinBudget` (`packages/owlbear/src/map-image.ts`), `mapImageSchema` (`packages/protocol/src/protocol.ts`).
- Revisit if: a real map exceeds the budget at quality 0.5, or the maintainer rules on Safari.
- Status: active

## 267.7 The query carries only the map item id; the extension reads the item's live placement

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved; the grid size coming from the engine, not the reply, is the maintainer's (#186).
- Context: the extension must draw the same display grid the engine uses for room cells.
- Options:
  - Chosen: `{ name: "map-image", itemId }`. The extension finds the item, builds its live `MapPlacement` with `mapPlacementOf` (the engine's `scenePlacement`, 191.2) and the grid with the engine's `displayGrid`; #186's use case reports the grid size from its own live read of the same item. An id that is not an image on the map layer fails before anything is fetched.
  - Send the placement in the query: the extension would draw a placement the table may no longer have, and the query grows a copy of `MapPlacement`.
- Where: `querySchema` (`packages/protocol/src/protocol.ts`), the `map-image` case of `handleQuery` (`packages/owlbear/src/queries.ts`).
- Status: active

## 267.8 The drawing is injected as a trailing default parameter of the query handler

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the canvas cannot run in the Node unit tests, and #189 changes the same handler in parallel.
- Options:
  - Chosen: `handleQuery(obr, sync, query, draw = drawMapImageOnCanvas)` and the same on `replyToQuery`. `main.ts` and every existing caller and test keep their arguments; unit tests pass a fake drawing. `ObrReader` also picks `fetchImage` (a read), so the handler fetches through the adapter.
  - Wire the drawing in `main.ts` as a required argument: every existing call site and test changes, including #189's.
  - `vi.mock` the canvas module in the tests: not used elsewhere in the repo.
- Where: `handleQuery`, `replyToQuery` (`packages/owlbear/src/queries.ts`), `ObrReader` (`packages/owlbear/src/obr-adapter.ts`).
- Status: active
