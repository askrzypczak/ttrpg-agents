# feature: TooManyTokens art is the default for a monster type when it enters the encounter

Issue: [#383](https://github.com/askrzypczak/ttrpg-agents/issues/383).

## 383.1 The default art is loaded from jsDelivr, else from raw.githubusercontent.com; the url that answered is stored, with the bytes

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate, not human-approved.
- Context: Per 357.7 (TooManyTokens art is the default wherever it covers the monster) and 357.8 (art is a url any browser loads, players may be remote). #379's `tooManyTokensUrls` gives a jsDelivr url and a raw.githubusercontent.com url, both pinned to the index's commit. R14 says art with a url is stored with its sha256, bytes first.
- Options:
  - Chosen: try the jsDelivr url, then the raw url, each through `ImageSource.load` (`NodeImageSource`: https only, 20 MiB cap, 5 s timeout, per 380.3). A try succeeds when the bytes pass `validateTokenImage`. The bytes are stored as fetched (no re-encode) and the art is `{ url, mime, width, height, sha256 }` with the url that answered.
  - jsDelivr only: a jsDelivr outage leaves every type with no default although GitHub serves the same file.
  - Store the url with no bytes: the extension would backfill the hash as a `table` set and retag the source (R14).
- Where: `loadDefaultArt`, `storeDefaultArt` (`packages/engine/src/encounter/default-art.ts`).
- Revisit if: a player's browser cannot load one of the two hosts, or #289 hosts art elsewhere.
- Status: active

## 383.2 Checks, then the default art load, then the table reads, then the art and the write in one transaction; three async siblings and an optional dependency on the add

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (Q2, audit finding 1), not human-approved.
- Context: The load is async and can take up to about 10 s per type; the store's use cases are sync and the store's transactions are sync. 50.4 orders the add as input checks, then map and room checks, then table reads, then the store write.
- Options:
  - Chosen: `loadDefaultArt` (async, no writes) and `storeDefaultArt` (sync, one `TokenArtRepository` transaction that stores and assigns the art, then runs the use case as `write`). `changeMonsterTypeWithDefaultArt`, `restoreMonstersWithDefaultArt` and `restoreEncounterWithDefaultArt` are async siblings of the sync use cases; `addMonstersInRooms`, already async, takes an optional `defaultArt` dependency. Each runs every stored-state check first, so a refused input loads nothing, and reads the table only after the load, so a table edit made during a fetch is not overwritten. Every `art-changed` event precedes the write's events.
  - One `ensureDefaultArt(deps, keys, origin, write)`: the add's table reads could not sit between the load and the write.
  - Make the three sync use cases async with an optional dependency: about 20 call sites change, and their reads would sit before the await unless restructured.
- Where: `default-art.ts`; `changeMonsterTypeWithDefaultArt`, private `checkChange` (`change-monster.ts`); `restoreMonstersWithDefaultArt`, `restoreEncounterWithDefaultArt` (`restore.ts`); `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Status: active

## 383.3 A failed or refused default art load never fails the call

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (D7 Q3), not human-approved.
- Context: Per 357.7 and the epic's D3 (always online; a failed fetch is an error case) and the epic's suggested default for its Q3, which the maintainer was asked to confirm.
- Options:
  - Chosen: when both tries fail (an `ImageUnavailableError`, or bytes `validateTokenImage` refuses), the type answers `failed` with one sentence per try, the use case's write still runs, and the GM gets the picker as today. Any other rejection from the port is a bug and is rethrown before anything is written. A store that refuses bytes the load already accepted (the same check, so not expected) throws and rolls the call back, as `setOwnTokenArt` does (implementer, 2026-11-20, not human-approved).
  - Fail the call: a CDN outage would block adding monsters.
- Where: `loadDefaultArt` (`default-art.ts`); `defaultArtLines` (`packages/mcp/src/tools.ts`).
- Revisit if: the maintainer vetoes the epic's Q3 default.
- Status: active

## 383.4 The four tools reply with a line only for a type that got the default or failed to, in the text only

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate, not human-approved.
- Context: The ticket asks for one line per type that got default art or failed to. R18 names the default's source in words.
- Options:
  - Chosen: `set` gives "<Name>: token art set to the TooManyTokens default."; `failed` gives "No TooManyTokens art for <Name>; the GM will be asked to pick. <reason>". `has-art` and `not-covered` give no line, and the structured content gets no new key (`summary` carries the text).
  - A line for every outcome: every existing exact-text reply test changes, and an uncovered type already behaves as before.
  - A structured `art` key: no consumer reads it today.
- Where: `defaultArtLines`, `restoredReply` (`packages/mcp/src/tools.ts`).
- Status: active

## 383.5 Tests that spawn the real MCP server seed the added type's art, or add a type the index does not cover

- Decided by: epic #375 orchestrator, 2026-11-20, plan gate (Q1, audit finding 3), not human-approved.
- Context: The spawned server uses the committed index and the real `NodeImageSource`, and `srd-2024_shadow` is covered, so an add of Shadows would fetch over the network. In live-sync a successful fetch also logs `art-changed` before `added` and breaks the `seq + 1` assertion.
- Options:
  - Chosen: seed a `table` art row for `srd-2024_shadow` in live-sync's `beforeEach` and in stdio's `connect()`; the three settings and profile tests, which assert where the server creates its database, add `srd-2024_spy`, which the index does not cover.
  - Let the tests reach the network: they would fail or change on a machine whose fetch succeeds.
- Where: `packages/bridge/src/live-sync.integration.test.ts`, `packages/mcp/src/stdio.integration.test.ts`.
- Status: active
