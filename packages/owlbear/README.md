# @ttrpg-agents/owlbear

Owlbear Rodeo extension (GM-only panel that talks to the local bridge).

## Layering

- `src/obr-adapter.ts` is the ONLY module that imports `@owlbear-rodeo/sdk`
  (ESLint `no-restricted-imports` enforces it). It exposes the narrow
  `ObrAdapter` interface and `createObrAdapter()`.
- `src/scene-model.ts` is a pure in-memory scene (items, scene metadata, role,
  ready flag, change listeners). No SDK or vitest imports.
- `src/fake-adapter.ts` implements `ObrAdapter` over a `SceneModel`.
- Logic modules (`hidden-token.ts`, ...) take an `ObrAdapter`, never the SDK.
  `initiative.ts` is a pure projector (the Initiative Tracker metadata that
  `defaultSyncConfig` uses), not a logic module. `main.ts` wires
  `createObrAdapter()` into the logic modules.

## Encounter sync

`src/encounter-sync.ts` keeps the desired encounter (the latest bridge snapshot folded with later events of both origins in `seq` order; events before the first snapshot are ignored, an event whose `seq` is at or before the last one is a duplicate and ignored, and an event that skips a `seq` is a gap: nothing is applied, `options.onGap` is called once and events are ignored until the next snapshot; `main.ts` reconnects for a snapshot) and reconciles the scene against it on every trigger: a message, the scene becoming ready, an item change, or a retry. `src/sync-plan.ts` holds the pure planner `planSync(desired, observed, config, { viewportCenter, placed, art, snapshot, fields })`; `defaultSyncConfig` mirrors instances as hidden (`visible: false`) tokens on the CHARACTER layer (an IMAGE token from the stored art of the monster type, else a circle SHAPE), named after the instance, at the instance's spawn position when it has one, otherwise in a row near the viewport centre, each token in a slot as wide as its footprint. Tokens are linked by metadata key `com.ttrpg-agents/instance` (`{ instanceId }`); only items carrying it are ever touched. Per-token metadata comes from projectors (`owned` keys follow the encounter, `create-only` keys are written at creation). Each synced token also carries the Initiative Tracker metadata (`rodeo.owlbear.initiative-tracker/metadata`, `{ count, active }`) as an owned key. The projected `active` is carried over from the token's current value, so the tracker's turn marker survives (a new token starts with `active` false), and a changed encounter initiative pushes the new count without resetting `active`. The tracker metadata is not written for a null initiative (an existing tracker value is left alone). A tracker-side edit of `count` survives until the encounter initiative changes, and is written back (see below). The tracker keeps `count` as free text: it is read as a whole number (optional sign and digits, after trimming) and anything else is an unreadable value. A token removed from the tracker (its key deleted) clears the instance's initiative, and a `count` on a token whose instance has no initiative (typed, or the tracker's starting count when the token is added) is adopted, whatever the baseline. `active` is never read. Each synced token also carries the Stat Bubbles metadata (`com.owlbear-rodeo-bubbles-extension/metadata`: `health`, `max health`, `armor class` when the instance has one, and `hide`) as an owned key. `hide` follows the instance's `statsVisible` (false by default, so true: players see no bubbles and no Edit Stats menu; the DM reveals or hides through the MCP tool `set_stats_visibility` or `add_monsters`' `statsVisible`). A `hide` the GM toggled at the table wins until the encounter changes `statsVisible` again: the planner passes the key's baseline (the raw value last written) to the projector as a third argument, and the projector pushes `hide` only when its raw value differs from the baseline's. Saying the same value again is not a change, so it does not override a table toggle. Temporary health and other fields of the token's value are carried over, not written. An edit to `health`, `max health` or `armor class` on the table (by the GM, or by a player when the stats are revealed), or to the tracker's `count`, is written back, and the planner decides these fields one by one (the projector names them in `editFields`; `hide`, `active` and the other fields keep the key-level rule). A projector whose value holds a stored number in another form (the tracker's `count` is a string) names it in `encodeField`, and the planner compares the store, the table and the sent edits in the value's space. `createEncounterSync` passes `planSync` whether the reconcile follows a `snapshot` and, per instance, `fields`: which edit fields the store `moved` (an `mcp` event changed the value, or the store changed a field a command did not set), which are `settled` (acknowledged, at the sent value; at the store's value for a `table` event whose command id the extension does not know, as after a reload; a refused edit at its sent value), both since the last successful reconcile (facts that arrive during a reconcile are kept for the next one), and which are `inflight` (an edit queued or not yet acknowledged, at its latest value). Per field: one in flight keeps the table's value; else the store's value is pushed if the field moved, or after a snapshot if the store differs from the baseline and the field is not settled; else the table's value stays and, when it differs from the agreed value (the settled one, else the baseline's) and from the one in flight, is returned in `edits` (`readBack` reads it; a value that is not a whole number within the safe integer range goes to `rejected` instead, stays on the table and is reported once per store change (a snapshot or an applied `mcp` event) through `options.onEditRejected`, shown in the panel, but only if it is still unreadable when the settle delay ends; when a reported value stops being planned as unreadable the sync calls `options.onEditRejectedCleared(text)` and `main.ts` clears the panel's edit error if it is that text). The baseline records the agreed values, so a clamped value is neither pushed nor sent again; without that context a store change of these fields is not pushed. After the metadata write `createEncounterSync` splits each edit into single-field `instance-edit` commands (max HP, then HP, then armor class, then initiative, so each has exactly one acknowledging event; envelope id `instance-edit:<instanceId>:<uuid>`). Each is held per instance and field for `EDIT_SETTLE_MS` (1.5 s, on the injected `options.timers`): a different planned value restarts the delay, the same value planned again (an unrelated item change) keeps it, and an edit the plan no longer contains (the table went back to the agreed value, or an `mcp` change moved the field) is dropped. When the delay ends the command is submitted to the outbox (`src/outbox.ts`) inside the reconcile chain, and from then on it is in flight. Held edits do not count as waiting for the bridge, so the store lags the table by about 1.5 s after the last change. The outbox sends through `options.send` (`main.ts` passes `socket.send`, which returns false until the `hello-ack`); a command that does not go out, or comes while older ones wait, is queued and sent in order at the next `hello-ack`, which reaches it through `handleMessage` before the snapshot that follows is applied. `options.onWaitingChange` reports how many wait (`main.ts` passes the count to `panelView`, which adds "Table changes for the bridge: N waiting." to the note line, `#edit-note`). A command is remembered until the store settles it; one sent on a connection that has since dropped is forgotten at the next snapshot, so a lost edit is planned and sent again, and after a reload a typed value the store does not hold is sent again unless the store's value changed since the last write. An art pick has no answer, so nothing settles it: it is forgotten at the snapshot that follows the next `hello-ack` and is never sent again, so a pick lost in flight is not stored. The store's answer is the `table` event carrying the command id: it pushes nothing for the field the command set, and a field the command did not set that the store changed is pushed (lowering max HP below current HP pushes the clamped HP, with no extra edit and no note). The bridge clamps like a DM command (HP to 0..max HP, armor class at least 0); an acknowledgement whose value differs from the sent one keeps the typed value on the token and calls `options.onEditDiffers` with a note (`main.ts` shows it in the muted `#edit-note` line until the next store change, which `options.onStoreChange` signals; a `table` event is not one, so the note stays). A refused edit keeps the typed value, is settled so that it is not sent again, and shows the bridge's error in the panel. Only a store change caused by the MCP writes to the table: an `mcp` event that changes a field pushes it, even over a table edit, unless an edit of that field is in flight (that edit commits later, so the store ends at the typed value too). The exception is a snapshot (#209, option (a), decided by Tony): it has no origin, so it writes the store's value over a value kept on the token (a clamp or a refusal). Each write a snapshot makes over a different token value in one of these fields is reported in `plan.overrides`; the sync calls `options.onSnapshotOverride(text)` once per record after the write, and `main.ts` lists the records under `#overrides` (its heading says a snapshot, on connect, on reconnect or after a skipped change, cannot tell an MCP change made meanwhile from a clamped value) until the DM presses `#dismiss-overrides`. A snapshot with no `hello-ack` since the last one (sent on the same connection in place of an unreadable change-log row) may cover the answers of edits already sent, so the sync forgets the sent edits; one the store has not applied yet is planned and sent again. `onStoreChange` leaves the list alone, and it is kept in memory only. Temporary health is not written back, and the last write wins. An armor class set at the table on an instance with no stored armor class is not adopted, and an unreadable value stays on the table with its rejection message. Stat Bubbles draws only IMAGE tokens on the CHARACTER or MOUNT layer, so a circle token without art shows no bubbles. The table wins: an `owned` key is pushed only when the encounter changed since we last wrote it (the baseline, kept on the token under `com.ttrpg-agents/synced`), so a GM edit survives until the encounter changes that value again (an edit written back leaves the baseline alone until the store settles it); a value with no baseline is adopted, not overwritten. The token name follows the encounter under the same table-wins rule (its baseline is kept under key `name` in `com.ttrpg-agents/synced`; a GM rename is kept until the store name changes again); position and visibility are set at creation only. Deletion sticks: instance ids already placed are recorded in scene metadata `com.ttrpg-agents/placed`, so a token the GM deleted is not recreated (a fresh scene has no record and is populated). A deleted token is reported: `planSync` returns `deleted` (wanted instances in `placed` with no token), and `createEncounterSync` subscribes `ObrAdapter.onItemsChange` to reconcile on table changes and submits a `token-deleted` command (envelope id `token-deleted:<instanceId>:<uuid>`) to the outbox for each, once per store change and not again while one is in flight (the `table` event of the removal acknowledges it; a bridge refusal shows in `#sync-error` until the next store change). The fake host answers the items subscription and posts item change events. Token art: `planSync` returns `needsArt` (monster keys of instances about to get a token that have no usable art); `createEncounterSync` then calls `ObrAdapter.pickImage()` (the Owlbear asset picker) once per type that has no stored art, validates the result with `publishedTokenArtSchema`, submits a `token-art-set` (no envelope id; the bridge does not answer it) to the outbox, which queues it while the socket is down, and re-plans. A cancel, a picker error or an invalid image creates the circle, shows no error, and is not asked again this session. With `options.storeImage` (`main.ts` passes `uploadTokenImage` from `src/token-art.ts`, a `POST /token-images` with the extension token as a bearer), the sync then fetches the picked image (`ObrAdapter.fetchImage`) and uploads its bytes outside the reconcile chain, so the tokens do not wait. When the bridge answers with the image's hash, the sync puts it on its art for the type (if that is still the picked image) and submits a second `token-art-set` with `sha256`. Each pick gets one attempt: a failed fetch, a refused upload or a failed upload calls `options.onArtStoreFailed` once with `Could not store the image of the token art for <monsterKey>; it is kept as a link: <reason>`, and the art stays a link. `main.ts` shows that text in `#sync-error` until the panel reloads (a store change does not clear it; a later failure replaces it). Art that has a url and no `sha256` (picked before its bytes were stored, or whose upload failed) gets its bytes the same way: on each snapshot, once per type per session, whether or not its type gets tokens and outside the reconcile chain, the sync asks `ObrAdapter.isImageAlive(url)` (described below); when the url answers, it fetches and uploads the bytes as after a pick and reports a failure with the same text. A gone url, or a check that cannot tell, leaves the art as it is with nothing shown, and its tokens are drawn with it as before. A type picked this session is not checked: its pick was its attempt. Stored art whose Owlbear asset is gone is published again when the sync has `options.loadImage` (`main.ts` passes `downloadTokenImage` from `src/token-art.ts`, a `GET /token-images/<sha256>` with the extension token as a bearer). Once per type per session, when a type whose art has a `sha256` and was neither picked nor checked on connect this session is about to get tokens, the sync asks `ObrAdapter.isImageAlive(url)` (a no-cache fetch: 2xx is alive, 4xx is gone; a network error or another status cannot tell, and the stored art is used). For a gone url the sync loads the stored bytes from the bridge, uploads them to the GM's asset library with `ObrAdapter.uploadImage` under the name `ttrpg-art-<first 16 hex of the sha256>` (`republishName`), and waits on `options.awaitUploadConfirmed(prompt)`: `main.ts` shows the prompt in `#art-prompt` with the `#pick-art` button ("Pick the uploaded image"), opens the panel (`ObrAdapter.openPanel`) and resolves when the GM presses it. The GM sees two Owlbear dialogs: the upload's folder dialog, then the picker, which `ObrAdapter.pickImage(name)` opens with the asset name as its default search. A valid pick becomes the type's art with the existing `sha256` (the same bytes, so nothing is fetched or stored again) and is sent as one `token-art-set`, all before the tokens are created. Stored bytes that cannot be loaded, a failed upload, or a cancelled, failed or invalid pick leave the stored art unchanged, create the circle and are not asked again this session; a failed load also calls `options.onArtRepublishFailed` with `Could not republish the token art for <monsterKey>: <reason>`, which `main.ts` shows in `#sync-error` like a failed image store. Art without a url (`{ sha256 }` alone: stored bytes never published, for example from the local library import) is never drawn: the sync leaves it out of the plan's art, so its type is in `needsArt`, but the fresh picker never opens for a type that has stored art, since a fresh pick would drop the link to its bytes. With `options.loadImage` the sync publishes it like gone art, with no liveness check and under the same once-per-session rule, when its type first gets tokens; the pick completes the art with its `sha256`. Until then, without `options.loadImage`, or for the session after a cancel or a failure, the type's tokens are circles. After any of these art steps (the picker opened, or a stored art check, republish or first publish ran), the reconcile reads the scene items and the `placed` record again before it plans its writes, so a table edit made while the GM was asked is kept and a scene switched meanwhile is planned as it now is; a reconcile with no art step reads them once. Storing the bytes of art without a hash is not an art step: it runs outside the reconcile and touches no scene items. The viewport centre for new tokens is read once, before the art steps. Published art is a VTT-neutral `{ url, mime, width, height }`; `pickImage` ignores the SDK's own grid, and the token's Owlbear grid is derived in `sync-plan.ts` at creation: dpi is the longer side divided by the instance's footprint in cells, and the offset is the image centre, so the image spans its footprint. The footprint comes from the engine, from the monster's size category (small and medium 1 cell, large 2, huge 3, gargantuan 4, tiny and unknown sizes 1), and is stored per instance (`footprint`, 1 for older rows). A new hidden circle is footprint cells wide and high. Art applies to new tokens only; existing tokens are never resized or re-skinned. Other table edits (names, temporary health) are not written back to the encounter. Reconciles are serialised, and `createEncounterSync(obr)` does nothing until `isSceneReady()` (the bridge snapshot usually beats the scene after a room reload); the ready flip reconciles again. Item metadata is written key by key with `setItemMetadata` (other keys kept, `undefined` clears), not by replacing the whole object. A failure on a ready scene is shown in the panel (`#sync-error`, "Encounter sync failed: ...") until a reconcile succeeds (failures are retried with backoff); a scene that vanishes mid-apply counts as deferral, not failure. Both fakes (`createFakeObr`, the e2e fake host) reject item calls with `MissingDataError: No scene found` while the scene is not ready, like the real SDK. SHAPE items need a `shape` spec; the adapter exposes `getViewportCenter()`.

## Map overlay

`src/overlay-plan.ts` is the pure plan. `mapPlacementOf(item, grid)` gives the
placement of an IMAGE on the MAP layer (with image and grid specs) through the
engine's `scenePlacement`, and is undefined for any other item.
`planOverlay(placement, rooms)` returns the items in scene coordinates: per
display column a tick above the grid's top edge and its letter (A, B, ...,
AA), per display row a tick left of the left edge and its number, and per room
a closed CURVE for each polygon plus its name centred in the first polygon's
bounding box. Confirmed rooms are solid green; proposed rooms are dashed amber
and named `<name> (proposed)`. Every item is a locked, unhittable DRAWING item
with a deterministic id `ttrpg-overlay-<part>-<n>` and the metadata key
`com.ttrpg-agents/overlay` (`{ part }`).

`src/overlay.ts` (`createMapOverlay(obr, { onError })`) is the controller,
on at creation. It reconciles (serialised and coalesced) when the bridge's
`map-rooms` arrives (`setRooms`), the toggle changes (`setEnabled`), a scene
item changes or the scene becomes ready; nothing runs before the first
`map-rooms` or while the scene is not ready. It wants no items when it is off,
no map is in use, the map item is gone or the grid is not SQUARE, else the
plan. When the planned items are unchanged (same JSON) it writes nothing, so a
token move does not redraw; otherwise it deletes the local items carrying the
overlay key and adds the planned ones. The first draw after creation or after
the scene becomes ready always does this, so items left by an earlier load go.
It only ever removes its own items (by key), and it writes local items only
(`ObrAdapter.addLocalItems`, `getLocalItems`, `deleteLocalItems` over
`OBR.scene.local`): nothing reaches the scene or other clients. A failure goes
to `onError` (`main.ts` logs it) and the next trigger redraws from scratch.
`main.ts` creates it for a GM with a token, routes `map-rooms` to it and wires
the panel's `#overlay-toggle` ("Show map grid and rooms", on at every load,
not saved).

## Map image

`src/map-image.ts` is pure: `planMapImage(placement)` lays out the answer to
a `map-image` query (the engine's display grid in whole-pixel cells inside a
one-cell margin, long side at most 1600 px, cell lines, column letters and
row numbers on all four edges, and the transform that draws the source image
as the DM sees it, clipped to the grid); `encodeWithinBudget(convert)` tries
WEBP at quality 0.85, 0.7 and 0.5 (JPEG at the same quality when the browser
answers another type for WEBP) and keeps the first that fits
`MAP_IMAGE_MAX_BYTES`, the image bytes whose base64 fits the bridge's
`MAX_MESSAGE_BYTES`; `bytesToBase64` encodes the reply. `src/map-image-canvas.ts`
(`drawMapImageOnCanvas`) is the only canvas code, browser-only: it draws the
fetched bytes on an `OffscreenCanvas`. `handleQuery` and `replyToQuery` take
it as a trailing default parameter, so unit tests pass a fake drawing.

## Testing

Tests live next to the code as `src/*.test.ts` and run under the root vitest
(`npm test` / `npm run check`); no browser is needed.

```ts
const { obr, scene } = createFakeObr(new SceneModel("gm"));
await addHiddenToken(obr, {
  id: "t1",
  name: "Goblin",
  position: { x: 0, y: 0 },
});
expect(scene.getItems()[0]?.visible).toBe(false);
```

`createObrAdapter()` itself is not unit-tested (it needs the real SDK); the
Playwright e2e suite (below) covers it. Image items need `image` and `grid` specs
because the real adapter builds them with the SDK's `buildImage`; `layer`
defaults to `CHARACTER` and `scale` to `{ x: 1, y: 1 }`.

The token art calls of `ObrAdapter` are `pickImage(defaultSearch?)`,
`fetchImage`, `isImageAlive`, `uploadImage` and `openPanel`. The unit fake
takes `pickImage` (art, a cancel, or a function of the default search),
`fetchImage`, `imageAlive` (default alive) and `uploadImage` (the upload's
outcome) as options, and records the uploaded images in `uploads()`.

The local item calls of `ObrAdapter` (`addLocalItems`, `getLocalItems`,
`deleteLocalItems`, over `OBR.scene.local`) work on a second `SceneModel` in
the unit fake: pass it as the `local` option or read it from the result's
`local`. They reject with `MissingDataError` while the scene is not ready.
TEXT, LINE and CURVE items need a `text`, `line` or `curve` spec; `locked` and
`disableHit` default to false.

Use `scene` for assertions and to drive changes (`scene.setReady(true)`).
When adding an SDK call, extend `ObrAdapter`, `createObrAdapter()` and the
fake together. The e2e fake host reuses `SceneModel`.

## E2E (Playwright, no Owlbear account)

`npm run test:e2e` (root) builds everything, then runs `e2e/*.e2e.ts` on
Chromium. First time: `npx playwright install chromium`. It is NOT part of
`npm run check` (needs a browser); CI runs it as the separate `e2e` job.

- Each Playwright worker starts its own real bridge (`packages/bridge/dist/cli.js`,
  `e2e/worker-bridge.ts`) on an ephemeral port, with its own token file and
  seeded SQLite file in a per-worker subdir of the run temp dir, so parallel
  workers never share a bridge client. It serves the real built extension
  (`dist`). A tiny server (`e2e/serve.ts`, 127.0.0.1 on
  another ephemeral port) serves the harness (`dist-e2e`, never the production
  `dist`) on a different origin, which iframes the extension with a proper
  `?obrref=`. The harness server is shared. The config sets `E2E_HARNESS_PORT` and
  `E2E_DIR` (`e2e/env.ts`) before workers start, and workers inherit them.
- `e2e/fake-host.ts` plays Owlbear over `postMessage` (OBR_READY, then
  `<id>_RESPONSE<nonce>`), backed by `SceneModel`. It answers only the calls
  the extension makes. Any other id gets an `_ERROR` reply and is recorded in
  `window.__host.errors`; an auto fixture fails every test that leaves errors
  behind, so the fake cannot drift silently. When you add an SDK call, add it
  to `ObrAdapter`, the unit fake, and `fake-host.ts` together.
- `e2e/helpers.ts` holds shared page actions: `readItems`, `whileExtensionAway`,
  and `controlBridgeSocket` (routes the extension's socket to the bridge through
  Playwright's `page.routeWebSocket`, so a test can drop it and let it back).
- The extension adds items through `encounter-sync.ts`. `e2e/driver.html` is
  a test-only page that runs the real `createObrAdapter()` through the
  `addHiddenToken` helper.
- `encounter-sync.e2e.ts` covers encounter -> hidden tokens end to end. The
  bridge runs on a throwaway SQLite file (`TTRPG_AGENTS_DB`, `e2e/db.ts`,
  created per worker in the run temp dir and removed when the run ends) seeded with 5
  shadows before it starts, never your real database.
  `token-art.e2e.ts` routes the picked image's CDN URL (`page.route`) to an
  inline 1x1 PNG, as the Owlbear CDN would serve it (a 404 for the failure
  test), and reads the stored art and image rows through `e2e/db.ts`. For
  stored art it seeds the art and its image with `seedE2eTokenArt` and routes
  the stored url to a 404 (the asset is gone) or to the PNG (alive); art
  `null` seeds the image hash alone (art never published). The fake
  host answers `OBR_ASSETS_UPLOAD_IMAGES` at once (the real one then asks the
  GM for a folder) and records each image in `window.__host.uploads`, and
  answers `OBR_ACTION_OPEN`.
  `openHarness(page, { failItems: "msg" })` makes every item call fail with
  that message (to drive the panel error); those failures are not recorded in
  `host.errors`. The fake host also answers the viewport calls (fixed 1000x600
  screen, identity transform), the grid's dpi (150) and type (`SQUARE`), and
  the local item calls (get all, add, delete) over `window.__host.local`, a
  separate `SceneModel`; those reject while the scene is not ready and are not
  affected by `failItems`. `overlay.e2e.ts` seeds an active map and a room
  with `seedE2eMap` (`clearE2eMap` after), puts the map image on the fake
  scene, and checks the overlay's local items and the panel toggle.
  `map-image.e2e.ts` puts a map on the fake scene whose image is served
  cross-origin with CORS, posts `map-image` to the bridge, and checks that the
  real extension answers a WEBP of the planned size.
- Test-only workarounds (`fixtures.ts`, `playwright.config.ts`): the bridge's
  `frame-ancestors` CSP is rewritten to allow the harness origin, and
  Chromium's Local Network Access checks are disabled (a route-fulfilled
  document loses its loopback address space).
