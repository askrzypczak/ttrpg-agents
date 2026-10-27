# @ttrpg-agents/owlbear

Owlbear Rodeo extension (GM-only panel that talks to the local bridge).

## Layering

- `src/obr-adapter.ts` is the ONLY module that imports `@owlbear-rodeo/sdk`
  (ESLint `no-restricted-imports` enforces it). It exposes the narrow
  `ObrAdapter` interface and `createObrAdapter()`. An added item's rotation
  and lock are written (`toItem`); a read item carries its layer, rotation,
  scale and lock (`fromItem`).
- `src/scene-model.ts` is a pure in-memory scene (items, scene metadata, role,
  ready flag, change listeners). No SDK or vitest imports.
- `src/fake-adapter.ts` implements `ObrAdapter` over a `SceneModel`.
- Logic modules (`hidden-token.ts`, ...) take an `ObrAdapter`, never the SDK.
  `initiative.ts` and `stat-bubbles.ts` are pure projectors, not logic modules. `main.ts` wires
  `createObrAdapter()` into the logic modules.

## Encounter sync

The rules (what is written when, and who owns each value) are in
[`docs/architecture.md`](../../docs/architecture.md), "What reaches the
table". This section is the mechanics: which module does what, and the names
a ticket needs.

### Desired state and triggers

`src/encounter-sync.ts` (`createEncounterSync(obr, options)`) keeps the
desired encounter: the latest bridge snapshot folded with later events of both
origins in `seq` order. Events before the first snapshot are ignored, an event
at or before the last `seq` is a duplicate, and an event that skips a `seq` is
a gap: nothing is applied, `options.onGap` is called once and events are
ignored until the next snapshot (`main.ts` reconnects for one).

It reconciles the scene against that state on every trigger: a message, the
scene becoming ready, an item change (`ObrAdapter.onItemsChange`) or a retry.
Reconciles are serialised, nothing runs until `isSceneReady()`, and the ready
flip reconciles again. A failure on a ready scene is shown in `#sync-error`
("Encounter sync failed: ...") until a reconcile succeeds; failures are
retried with backoff, and a scene that vanishes mid-apply counts as deferral.
Item metadata is written key by key (`setItemMetadata`; `undefined` clears),
never as a whole object.

### The planner

`src/sync-plan.ts` holds the pure planner `planSync(desired, observed, config,
{ viewportCenter, placed, art, snapshot, fields, moves, restyles, reskins })`.
`defaultSyncConfig` mirrors each instance as a hidden (`visible: false`) token
on the CHARACTER layer, named after the instance: an IMAGE token from the
type's stored art, else a circle SHAPE. Tokens are linked by metadata key
`com.ttrpg-agents/instance` (`{ instanceId }`); only items carrying it are
touched.

Per-token metadata comes from projectors: `owned` keys follow the encounter,
`create-only` keys are written at creation. Each owned key's baseline, the raw
value last written, is kept on the token under `com.ttrpg-agents/synced`, and
a key is pushed only when the encounter changed since that baseline, so a
table edit survives until the encounter changes the value again. A value with
no baseline is adopted, not overwritten. The token name follows the same rule
under key `name`; visibility is set at creation only. A projector whose key
holds several fields applies the rule per field: the planner passes the key's
baseline as its third argument (Stat Bubbles `hide`).

### Initiative Tracker and Stat Bubbles

`src/initiative.ts` projects the Initiative Tracker metadata
(`rodeo.owlbear.initiative-tracker/metadata`, `{ count, active }`) as an owned
key. `active` is carried over from the token's current value (a new token
starts false) and never read, so the turn marker survives a pushed count.
Nothing is written for a null initiative. `count` is free text, read as a
whole number (optional sign and digits, after trimming); anything else is
unreadable. A deleted key clears the instance's initiative, and a count on a
token whose instance has none is
adopted whatever the baseline.

`src/stat-bubbles.ts` projects the Stat Bubbles metadata
(`com.owlbear-rodeo-bubbles-extension/metadata`: `health`, `max health`,
`armor class` when the instance has one, and `hide`) as an owned key. `hide`
follows `statsVisible` (false by default; `set_stats_visibility` and `add_monsters` change it) and is pushed only when its raw value differs
from the baseline's, so a `hide` the GM toggled wins until `statsVisible`
changes. Temporary health and other fields are carried over, not written.
Stat Bubbles draws only IMAGE tokens on the CHARACTER or MOUNT layer, so a
circle shows no bubbles.

### Table edits

HP, max HP, armor class and the tracker's `count` are written back, decided
one by one: the projector names them in `editFields`, `readBack` reads them
from the token, and `encodeField` names a field stored in another form (the
count is a string), so the planner compares the store, the table and the sent
edits in the value's space. `hide`, `active` and the other fields keep the
key-level rule.

`createEncounterSync` passes `planSync`, per instance, `fields`: which edit
fields the store `moved` (an `mcp` event changed the value, or the store
changed a field a command did not set) or `settled` (acknowledged at the sent
value; at the store's value for a `table` event whose command the extension
does not know, as after a reload; a refused edit at its sent value), both since
the last successful reconcile, and which are `inflight` (queued or
unacknowledged, at the latest value). Per field: one in flight keeps the
table's value; else the store's value is pushed if the field moved, or after a
snapshot if the store differs from the baseline and the field is not settled;
else the table's value stays and, when it differs from the agreed value
(settled, else the baseline) and from the one in flight, is returned in
`edits`. The baseline records the agreed values, so a clamped value is neither
pushed nor sent again.

A value that is not a safe whole number goes to `rejected`: it stays on the
table and is reported through `options.onEditRejected` once per store change,
but only if still unreadable when the settle delay ends;
`options.onEditRejectedCleared(text)` fires when it reads again, and `main.ts`
clears the panel's edit error. An armor class typed on an instance with none
is not adopted. Temporary health and names typed on the table are not written
back.

After the metadata write, each edit is split into single-field `instance-edit`
commands (max HP, HP, armor class, initiative; envelope id
`instance-edit:<instanceId>:<uuid>`) so each has one acknowledging event, and
held per instance and field for `EDIT_SETTLE_MS` (1.5 s, on
`options.timers`): a different value restarts the delay, the same value keeps
it, and an edit the plan no longer contains is dropped. When the delay ends the
command goes to the outbox and is in flight.

The store's answer is the `table` event carrying the command id: it pushes
nothing for the field the command set, and pushes a field the command did not
set that the store changed. An
acknowledgement that differs from the sent value keeps the typed value on the
token and calls `options.onEditDiffers` with a note (`main.ts` shows it in
`#edit-note` until `options.onStoreChange` signals the next store change). A
refused edit keeps the typed value, is settled so it is not sent again, and
shows the bridge's error.

A snapshot pushes the store's value over a kept clamp or refusal. Each such
write is reported in `plan.overrides`; the sync calls `options.onOverride(text)`
once per record after the write, and `main.ts` lists them under `#overrides`
until the DM presses `#dismiss-overrides` (in memory only; `onStoreChange`
leaves the list alone). A snapshot on the same connection (sent in place of an
unreadable change-log row) may cover the answers of edits already sent, so the
sync forgets them; one the store has not applied yet is planned and sent
again.

### The outbox

`src/outbox.ts` sends commands through `options.send` (`socket.send`, false until the `hello-ack`). A command that does
not go out, or comes while older ones wait, is queued and sent in order at the
next `hello-ack`, which reaches the outbox through `handleMessage` before the
snapshot that follows is applied. `options.onWaitingChange` reports how many wait (the count in `#edit-note`); held edits do not count. A command is remembered until the store settles it; one sent on
a connection that has since dropped is forgotten at the next snapshot, so a
lost edit is planned and sent again, and after a reload a typed value the
store does not hold is sent again unless the store's value changed since the
last write. An art pick has no answer: it is forgotten at the snapshot that
follows the next `hello-ack` and never resent.

### Position

A new token is created at its instance's spawn position, else in a row near
the viewport centre (`rowPositions`), each in a slot as wide as its footprint;
the viewport centre is read once, before the art steps. Each token records
the position the extension created it at or last moved it to under key
`position` in `com.ttrpg-agents/synced`, and under `previousPosition`
(`PREVIOUS_POSITION_KEY`) where it stood before its first move to a spawn
position: null for a token created in the default row, a point once such a
token is moved (kept on later moves), absent for a token created at a spawn
position or before the key existed (none is adopted, and an unreadable value
counts as absent).

A token whose instance has a spawn position is moved there (`plan.move`,
written with `updateItems` after the renames and before the metadata write)
when an `mcp` `position-changed` event named its instance since the last
successful reconcile (`moves`, kept for the retry) or when its recorded
position differs; a token already there is not written. When the spawn
position is cleared, the token moves back to its recorded `previousPosition`
on any reconcile, or, with none recorded, to a fresh default-row slot when an
`mcp` event named it (that row holds those tokens and the reconcile's new
tokens, in encounter order); a token whose `previousPosition` is null is never
moved back. Either way the record becomes where it went, with
`previousPosition` null. A move of a token that was not at its recorded
position, or has none, is reported in `plan.overrides` once written.

### Deletion and `placed`

Instance ids already placed are recorded in scene metadata
`com.ttrpg-agents/placed`, so a token the GM deleted is not recreated; a fresh
scene has no record and is populated. Ids the extension sees leave the
encounter (`removed`, `cleared`) are dropped before the next plan, so a restore
gets a new token. `planSync` returns `deleted` (wanted instances in `placed`
with no token), and `createEncounterSync` submits a `token-deleted` command
(envelope id `token-deleted:<instanceId>:<uuid>`) for each, once per store
change and not again while one is in flight; the `table` event of the removal
acknowledges it, and a bridge refusal shows in `#sync-error` until the next
store change.

### Token art

`planSync` returns `needsArt`: the monster keys of instances about to get a
token with no usable art. `createEncounterSync` then calls
`ObrAdapter.pickImage()` once per such type, inside the reconcile (an art
step): `options.onArtStep` hears the monster name and its place among the
reconcile's picks (`main.ts` shows "Art 1 of 2: ..." in `#art-prompt` and
opens the panel). A valid pick (`publishedTokenArtSchema`) is sent as a
`token-art-set` (no envelope id, no answer) and re-planned; a cancel, a picker
error or an invalid image creates a circle, shows nothing, and is not asked
again this session. After an art step the reconcile reads the scene items and
`placed` again before it writes, so a table edit made meanwhile is kept.

Published art is a VTT-neutral `{ url, mime, width, height }`; `pickImage`
ignores the SDK's own grid, and the token's Owlbear grid is derived at
creation (dpi is the longer side divided by the footprint in cells, offset the
image centre), so the image spans its footprint (`footprint`, from the engine, 1 for older rows).

**Bytes.** With `options.storeImage` (`uploadTokenImage` in `src/token-art.ts`,
a `POST /token-images`), the sync fetches the picked image
(`ObrAdapter.fetchImage`) and uploads its bytes outside the reconcile chain,
then puts the returned hash on the art (if it is still the picked image) and
sends a second `token-art-set` with `sha256`. Each pick gets one attempt: a
failed fetch or upload calls `options.onArtStoreFailed` once ("Could not store
the image of the token art for ..."), shown in `#sync-error` until the panel
reloads. Art with a url and no hash gets its bytes on each snapshot, once per type per session: when
`ObrAdapter.isImageAlive(url)` answers, the bytes are fetched and uploaded as
after a pick; a gone url, or a check that cannot tell, leaves the art as it
is, silently.

**Re-upload.** With `options.loadImage` (`downloadTokenImage`, a
`GET /token-images/<sha256>`), stored art is checked on each snapshot, once
per type per session, for every row with a hash and a url not picked this
session: `isImageAlive` makes a no-cache fetch (2xx alive, 4xx gone, anything
else cannot tell and keeps the art). A reconcile about to draw a type whose
check is pending waits for it. A type whose url is gone, or whose art has no
url while the encounter has an instance of it, is listed for re-upload and
left out of the plan's art, so its tokens are circles; the fresh picker never
opens for a type with stored art. Without `options.loadImage`, stored art is
used as it is and nothing is listed.

`options.onReuploadsChange` hears the list (`Reupload`: monster key, name via `monsterTypeName`, asset name `ttrpg-art-<first 16 hex of the hash>` via `republishName`, uploaded this session or not); `main.ts` shows it in `#reupload` near the top of the
panel, one row per type, and opens the panel when a type joins.

The row's "Re-upload" calls `sync.reuploadArt(monsterKey)`: the bytes are
loaded from the bridge and uploaded to the GM's library with
`ObrAdapter.uploadImage` under the asset name. The GM confirms the folder in
Owlbear's upload dialog, then "Pick the uploaded image" calls
`sync.pickUploadedArt(monsterKey)`, which opens the picker with the asset name
as its search. A valid pick keeps the existing hash, is sent as one
`token-art-set`, wins over a later snapshot's art for the session, takes the
type off the list and redraws its tokens (`reskins`, below). Bytes that cannot
be loaded or uploaded call `options.onArtRepublishFailed` ("Could not
republish the token art for ..."); that, or a cancelled, failed or invalid
pick, leaves the type listed, and the GM can press again. A second press while
one runs is ignored.

`EncounterSync.artWaits()` names the types whose fresh picker is open or still
to open (`pick`), then the listed types (`reupload`), with their monster names;
the `scene-status` answer carries it (`src/queries.ts`).

### Redraws and replacements

Each token records the look it was drawn with under key `look` in
`com.ttrpg-agents/synced` (`{ monsterKey, image }`, image null for a circle;
older tokens have none). A token is redrawn for its instance's new monster type
(`plan.restyle`, written after the renames and moves) when an `mcp`
`monster-changed` event named its instance since the last successful reconcile
(`restyles`, kept for the retry) or when its recorded look names another
monster key. It is drawn as a new token of the type would be (a type with no
art goes through `needsArt` as for a new token), at scale 1. When the kind
stays, the redraw is in place, and a token already drawn that way is not
written. A redraw over a token whose picture or scale the GM changed, or that
has no recorded look, is reported in `plan.overrides`; a token with no
recorded look is redrawn only for a `restyles` or `reskins` entry.

When the kind must change (a SHAPE whose type has art, an IMAGE whose type has
none), the token is replaced (`plan.replace`): the replacement carries the old
token's name, position, visibility, rotation, layer, lock and metadata as the
plan leaves them, with id `<old id>-r2` (`-r3`, ..., skipping ids on the scene). The sync marks the old token's synced record with that id under
`replacedBy` (`REPLACED_BY_KEY`), adds the replacement, then deletes the old
token. A failure in between fails the reconcile, and the retry finishes it: a
marked token whose replacement is not on the scene is replaced again, and one
whose replacement is on the scene is deleted first. The instance always keeps
a linked token, so no `token-deleted` is sent. Every replacement is reported in
`plan.overrides`. A pick of re-uploaded art redraws every token of its type
the same way (`reskins`; a monster change wins over it).

## Map overlay

`src/overlay-plan.ts` is the pure plan. `mapPlacementOf(item, grid)` gives the
placement of an IMAGE on the MAP layer through the engine's `scenePlacement`,
and is undefined for any other item. `planOverlay(placement, rooms)` returns
the items in scene coordinates: column letters and row numbers with a tick per cell along the top and left edges, and per room a closed CURVE for each polygon plus its name centred in
the first polygon's bounding box. Confirmed rooms are solid green; proposed
rooms are dashed amber and named `<name> (proposed)`. Every item is a locked,
unhittable DRAWING item with a deterministic id `ttrpg-overlay-<part>-<n>` and
the metadata key `com.ttrpg-agents/overlay` (`{ part }`).

`src/overlay.ts` (`createMapOverlay(obr, { onError })`) is the controller, on
at creation. It reconciles (serialised and coalesced) when the bridge's
`map-rooms` arrives (`setRooms`), the toggle changes (`setEnabled`), a scene
item changes or the scene becomes ready; nothing runs before the first
`map-rooms` or while the scene is not ready. It wants no items when it is off,
no map is in use, the map item is gone or the grid is not SQUARE, else the
plan. Unchanged planned items (same JSON) write nothing; otherwise it replaces the local items carrying the overlay key, always on the first draw after creation or scene-ready.

It only ever removes its own items (by key), and it writes local items only
(`ObrAdapter.addLocalItems`, `getLocalItems`, `deleteLocalItems` over
`OBR.scene.local`): nothing reaches the scene or other clients. A failure goes
to `onError` (`main.ts` logs it) and the next trigger redraws from scratch.
`main.ts` creates it for a GM with a token, routes `map-rooms` to it and wires
the panel's `#overlay-toggle` ("Show map grid and rooms", on at every load,
not saved).

## Map image

`src/map-image.ts` is pure: `planMapImage(placement)` lays out the answer to a `map-image` query (the display grid in whole-pixel cells inside a one-cell margin, labels on all four edges, and the transform that draws the source image as the DM sees it), and `encodeWithinBudget(convert)` tries WEBP at quality 0.85, 0.7 and 0.5 (JPEG when the browser cannot encode WEBP) and keeps the first that fits `MAP_IMAGE_MAX_BYTES`, derived from the bridge's `MAX_MESSAGE_BYTES`. `src/map-image-canvas.ts` (`drawMapImageOnCanvas`) is the only canvas code, browser-only; `handleQuery` and `replyToQuery` take it as a trailing default parameter, so unit tests pass a fake drawing.

## Testing

Tests live next to the code as `src/*.test.ts` and run under the root vitest (`npm test`); no browser is needed.

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
Playwright e2e suite (below) covers it. Image items need `image` and `grid` specs because the real adapter builds them with the SDK's `buildImage`.

The token art calls of `ObrAdapter` are `pickImage(defaultSearch?)`,
`fetchImage`, `isImageAlive`, `uploadImage` and `openPanel`. The unit fake
takes `pickImage` (art, a cancel, or a function of the default search),
`fetchImage`, `imageAlive` (default alive) and `uploadImage` (the upload's
outcome) as options, and records the uploaded images in `uploads()`.

The local item calls of `ObrAdapter` (`addLocalItems`, `getLocalItems`,
`deleteLocalItems`, over `OBR.scene.local`) work on a second `SceneModel` in
the unit fake: pass it as the `local` option or read it from the result's
`local`. They reject with `MissingDataError` while the scene is not ready.

Use `scene` for assertions and to drive changes (`scene.setReady(true)`). The e2e fake host reuses `SceneModel`.

## E2E (Playwright, no Owlbear account)

`npm run test:e2e` (root) builds everything, then runs `e2e/*.e2e.ts` on
Chromium. First time: `npx playwright install chromium`. Not part of `npm run check` (needs a browser); CI runs it as the separate `e2e` job.

- Each Playwright worker starts its own real bridge (`packages/bridge/dist/cli.js`,
  `e2e/worker-bridge.ts`) on an ephemeral port, with its own token file and
  seeded SQLite file (`TTRPG_AGENTS_DB`, `e2e/db.ts`, 5 shadows, removed when
  the run ends; never your real database) in a per-worker subdir of the run
  temp dir. A tiny shared server
  (`e2e/serve.ts`, 127.0.0.1 on another ephemeral port) serves the harness
  (`dist-e2e`) on a different origin, which iframes the extension with a proper `?obrref=`.
- `e2e/fake-host.ts` plays Owlbear over `postMessage` (OBR_READY, then
  `<id>_RESPONSE<nonce>`), backed by `SceneModel`. It answers only the calls
  the extension makes. Any other id gets an `_ERROR` reply and is recorded in
  `window.__host.errors`; an auto fixture fails every test that leaves errors
  behind, so the fake cannot drift silently. When you add an SDK call, add it
  to `ObrAdapter`, the unit fake, and `fake-host.ts` together.
- The fake host also answers the viewport calls (fixed 1000x600 screen,
  identity transform), the grid's dpi (150) and type (`SQUARE`), the local
  item calls over `window.__host.local` (a separate `SceneModel` that rejects
  while the scene is not ready), `OBR_ASSETS_UPLOAD_IMAGES` at once (recording
  each image in `window.__host.uploads`) and `OBR_ACTION_OPEN`.
  `openHarness(page, { failItems: "msg" })` makes every item call fail with
  that message; those failures are not recorded in `host.errors`.
- `e2e/helpers.ts` holds shared page actions: `readItems`, `whileExtensionAway`,
  and `controlBridgeSocket` (routes the extension's socket to the bridge through
  Playwright's `page.routeWebSocket`, so a test can drop it and let it back).
  `e2e/driver.html` runs the real `createObrAdapter()` for the driver tests.
- Suites: `encounter-sync.e2e.ts` covers encounter -> hidden tokens end to
  end. `token-art.e2e.ts` routes the picked image's CDN URL (`page.route`) to
  an inline 1x1 PNG (a 404 for the failure test), seeds stored art with
  `seedE2eTokenArt` (art `null` seeds the image hash alone) and routes its url
  to a 404 or the PNG, and reads the rows through `e2e/db.ts`.
  `overlay.e2e.ts` seeds an active map and a room with `seedE2eMap`
  (`clearE2eMap` after) and checks the overlay's local items and the panel
  toggle. `map-image.e2e.ts` serves a map image cross-origin with CORS, posts `map-image` to the bridge, and checks the real extension's WEBP answer.
- Test-only workarounds (`fixtures.ts`, `playwright.config.ts`): the bridge's
  `frame-ancestors` CSP is rewritten to allow the harness origin, and
  Chromium's Local Network Access checks are disabled (a route-fulfilled
  document loses its loopback address space).
