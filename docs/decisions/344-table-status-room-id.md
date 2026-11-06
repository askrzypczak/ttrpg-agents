# feature: table_status names the Owlbear room the GM tab is connected to

[#344](https://github.com/askrzypczak/ttrpg-agents/issues/344)

## 344.1 The `scene-status` answer carries the room id as an optional field; without it `table_status` says the room is unknown and to reload the Owlbear tab

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: The bridge serves the extension, and an Owlbear tab opened before an upgrade keeps its old code and reconnects after a bridge restart, so its answer has no room id. The ticket's own case is such a reconnect.
- Options:
  - Chosen: `roomId: z.string().optional()` on `sceneStatusSchema`, as `artWaits` defaults for an older tab (310.7). `table_status` writes "(room unknown: reload the Owlbear tab)" in the summary line and leaves `roomId` out of its structured result.
  - Required field: nothing extra to build, but the bridge rejects the older tab's answer as an invalid payload and `table_status` times out until the GM reloads, an error that does not name its cause.
- Where: `sceneStatusSchema` (`packages/protocol/src/protocol.ts`); `TableSceneStatus` (`packages/engine/src/table/port.ts`); `createBridgeTable` (`packages/bridge/src/client.ts`); `tableStatusTool` (`packages/mcp/src/tools.ts`).
- Revisit if: the extension and bridge get a version handshake that makes an older tab reload itself.
- Status: active

## 344.2 The room is named by its id from `OBR.room.id`; no room slug or name

- Decided by: maintainer (#344 body, 2026-11-06) for the id and for not scraping; that no supported way to the slug exists is the work-ticket orchestrator's finding at the plan gate.
- Context: The DM wants to confirm the connected tab is in their session's room. The room URL has the form `/room/<id>/<slug>`.
- Options:
  - Chosen: the id only, from `OBR.room.id`, read by `getRoomId` in `obr-adapter.ts`. In SDK 3.1.0 `RoomApi` has `id`, permissions and metadata, and no name.
  - The slug from the parent page URL: scraping, which the ticket rules out.
- Where: `getRoomId` (`packages/owlbear/src/obr-adapter.ts`), `handleQuery` (`packages/owlbear/src/queries.ts`).
- Revisit if: the SDK adds a room name or slug accessor.
- Status: active

## 344.3 No manual check that `OBR.room.id` equals the id in the room URL

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: The ticket asked for one check in a real room. The agent container cannot reach Owlbear. SDK 3.1.0 reads the id from the `obrref` parameter the host passes (`lib/common/getDetails.js`), so the tests show the value is passed through, not that it matches the URL.
- Options:
  - Chosen: drop the check.
  - The maintainer runs it on the Mac at review, with the PR marking it pending until then.
- Where: `getRoomId` (`packages/owlbear/src/obr-adapter.ts`).
- Revisit if: a DM sees a `table_status` room id that differs from the room URL.
- Status: active

## 344.4 `table_status` keeps a separate `roomId` key in its structured result

- Decided by: maintainer, 2026-11-06, plan gate.
- Context: Every reply built with `ok` already carries its text as `summary` (311.1), so the agent sees the room id there either way; 312.2 skipped a key that only repeated values already in the reply.
- Options:
  - Chosen: a `roomId` key, as `table_status` already keys each number its line states; a program or test reads it without parsing text.
  - The id in `summary` only: one key fewer, but a program would have to parse the line.
- Where: `tableStatusTool` (`packages/mcp/src/tools.ts`).
- Status: active

## 344.5 The fake adapter answers a constant room id, with no option

- Decided by: work-ticket orchestrator, 2026-11-06, plan gate (audit cut); the plan was approved by the maintainer.
- Context: The extension's query test needs a room id from the SDK fake.
- Options:
  - Chosen: `createFakeObr`'s `getRoomId()` returns `"fake-room"`.
  - A `roomId` option on `createFakeObr`: no test needs two room ids, and per-test fake options are added only when a test varies the value (189.7).
- Where: `createFakeObr` (`packages/owlbear/src/fake-adapter.ts`).
- Status: active

## 344.6 Only an absent room id reads as unknown; an empty one is shown as given

- Decided by: implementer, 2026-11-06; kept by the work-ticket orchestrator at review; not human-approved.
- Context: SDK 3.1.0's `getDetails` returns `""` for both the room id and the host origin when the `obrref` parameter is missing. With no origin the SDK's message bus accepts no message, so `OBR.onReady` never fires, and the extension answers queries only inside `onReady` (`packages/owlbear/src/main.ts`). A tab with an empty id therefore never answers `scene-status`.
- Options:
  - Chosen: `table_status` checks `roomId === undefined` only.
  - Treat `""` as unknown too: one more condition for a case the extension cannot reach.
- Where: `tableStatusTool` (`packages/mcp/src/tools.ts`).
- Revisit if: the SDK can be ready with an empty room id.
- Status: active
