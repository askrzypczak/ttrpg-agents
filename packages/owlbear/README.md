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

`src/encounter-sync.ts` keeps the desired encounter (the latest bridge snapshot folded with later events; events before the first snapshot are ignored) and reconciles the scene against it on every trigger: a message, the scene becoming ready, an item change, or a retry. `src/sync-plan.ts` holds the pure planner `planSync(desired, observed, config, { viewportCenter, placed, art })`; `defaultSyncConfig` mirrors instances as hidden (`visible: false`) tokens on the CHARACTER layer (an IMAGE token from the stored art of the monster type, else a circle SHAPE), named after the instance, in a row near the viewport centre, each token in a slot as wide as its footprint. Tokens are linked by metadata key `com.ttrpg-agents/instance` (`{ instanceId }`); only items carrying it are ever touched. Per-token metadata comes from projectors (`owned` keys follow the encounter, `create-only` keys are written at creation). Each synced token also carries the Initiative Tracker metadata (`rodeo.owlbear.initiative-tracker/metadata`, `{ count, active }`) as an owned key. The projected `active` is carried over from the token's current value, so the tracker's turn marker survives (a new token starts with `active` false), and a changed encounter initiative pushes the new count without resetting `active`. The tracker metadata is not written for a null initiative (an existing tracker value is left alone), so the tracker lists the token and a tracker-side edit survives until the encounter initiative changes. Each synced token also carries the Stat Bubbles metadata (`com.owlbear-rodeo-bubbles-extension/metadata`: `health`, `max health`, `armor class` when the instance has one, and `hide`) as an owned key. `hide` follows the instance's `statsVisible` (false by default, so true: players see no bubbles and no Edit Stats menu; the DM reveals or hides through the MCP tool `set_stats_visibility` or `add_monsters`' `statsVisible`). A `hide` the GM toggled at the table wins until the encounter changes `statsVisible` again: the planner passes the key's baseline (the raw value last written) to the projector as a third argument, and the projector pushes `hide` only when its raw value differs from the baseline's. Saying the same value again is not a change, so it does not override a table toggle. Temporary health and other fields of the token's value are carried over, not written. An edit to `health`, `max health` or `armor class` on the table (by the GM, or by a player when the stats are revealed) is written back: `planSync` asks the projector's `readBack` which of those fields differ from the encounter and returns them as `edits` (a value that is not a whole number goes to `rejected` instead, stays on the table and is reported once per snapshot through `options.onEditRejected`, shown in the panel), and `createEncounterSync` holds them in `src/edit-settle.ts` and calls `options.onInstanceEdit(edit)` once an instance's edits have stayed unchanged for `EDIT_SETTLE_MS` (500 ms; edits to one instance coalesce into one, and one put back to the encounter's value sends nothing; `main.ts` sends `instance-edit`; a bridge refusal shows in the panel until the next snapshot and the table gets the encounter's value back). Temporary health is not written back, and the last write wins. The bridge clamps like a DM command (HP to 0..max HP, armor class at least 0), and the clamped value ends up on the table. While an edit settles, and after it is sent until the store answers (the first snapshot, or an `instance-edit` error for that instance), the sync plans against the encounter with the edit applied, so the token keeps the typed number; it can flicker back only if an unrelated snapshot lands between the send and the answer. An edit still settling is lost if the tab closes. An armor class set at the table on an instance with no stored armor class is not adopted, and in an edit that mixes a valid and an unreadable field the unreadable one is overwritten by the normal push. Stat Bubbles draws only IMAGE tokens on the CHARACTER or MOUNT layer, so a circle token without art shows no bubbles. The table wins: an `owned` key is pushed only when the encounter changed since we last wrote it (the baseline, kept on the token under `com.ttrpg-agents/synced`), so a GM edit survives until the encounter changes that value again (when an edit is written back the baseline temporarily holds the edited table value, so the store's answer is judged by the same rule); a value with no baseline is adopted, not overwritten. The token name follows the encounter under the same table-wins rule (its baseline is kept under key `name` in `com.ttrpg-agents/synced`; a GM rename is kept until the store name changes again); position and visibility are set at creation only. Deletion sticks: instance ids already placed are recorded in scene metadata `com.ttrpg-agents/placed`, so a token the GM deleted is not recreated (a fresh scene has no record and is populated). A deleted token is reported: `planSync` returns `deleted` (wanted instances in `placed` with no token), and `createEncounterSync` subscribes `ObrAdapter.onItemsChange` to reconcile on table changes and calls `options.onTokenDeleted(id)` once per snapshot for each (`main.ts` sends `token-deleted`; a bridge refusal shows in `#sync-error` until the next snapshot). The fake host answers the items subscription and posts item change events. Token art: `planSync` returns `needsArt` (monster keys of instances about to get a token that have no art); `createEncounterSync` then calls `ObrAdapter.pickImage()` (the Owlbear asset picker) once per type, validates the result with `tokenArtSchema`, calls `options.onTokenArt(monsterKey, art)` (`main.ts` sends `token-art-set`) and re-plans. A cancel, a picker error or an invalid image creates the circle, shows no error, and is not asked again this session. The stored art is a VTT-neutral `{ url, mime, width, height }`; `pickImage` ignores the SDK's own grid, and the token's Owlbear grid is derived in `sync-plan.ts` at creation: dpi is the longer side divided by the instance's footprint in cells, and the offset is the image centre, so the image spans its footprint. The footprint comes from the engine, from the monster's size category (small and medium 1 cell, large 2, huge 3, gargantuan 4, tiny and unknown sizes 1), and is stored per instance (`footprint`, 1 for older rows). A new hidden circle is footprint cells wide and high. Art applies to new tokens only; existing tokens are never resized or re-skinned. Other table edits (names, initiative, temporary health) are not written back to the encounter. Reconciles are serialised, and `createEncounterSync(obr)` does nothing until `isSceneReady()` (the bridge snapshot usually beats the scene after a room reload); the ready flip reconciles again. Item metadata is written key by key with `setItemMetadata` (other keys kept, `undefined` clears), not by replacing the whole object. A failure on a ready scene is shown in the panel (`#sync-error`, "Encounter sync failed: ...") until a reconcile succeeds (failures are retried with backoff); a scene that vanishes mid-apply counts as deferral, not failure. Both fakes (`createFakeObr`, the e2e fake host) reject item calls with `MissingDataError: No scene found` while the scene is not ready, like the real SDK. SHAPE items need a `shape` spec; the adapter exposes `getViewportCenter()`.

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
- `e2e/helpers.ts` holds shared page actions: `readItems`, `whileExtensionAway`.
- The extension adds items through `encounter-sync.ts`. `e2e/driver.html` is
  a test-only page that runs the real `createObrAdapter()` through the
  `addHiddenToken` helper.
- `encounter-sync.e2e.ts` covers encounter -> hidden tokens end to end. The
  bridge runs on a throwaway SQLite file (`TTRPG_AGENTS_DB`, `e2e/db.ts`,
  created per worker in the run temp dir and removed when the run ends) seeded with 5
  shadows before it starts, never your real database.
  `openHarness(page, { failItems: "msg" })` makes every item call fail with
  that message (to drive the panel error); those failures are not recorded in
  `host.errors`. The fake host also answers the viewport calls (fixed 1000x600
  screen, identity transform).
- Test-only workarounds (`fixtures.ts`, `playwright.config.ts`): the bridge's
  `frame-ancestors` CSP is rewritten to allow the harness origin, and
  Chromium's Local Network Access checks are disabled (a route-fulfilled
  document loses its loopback address space).
