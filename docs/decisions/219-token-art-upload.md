# feature: extension uploads picked token art bytes to the bridge

Issue: [#219](https://github.com/askrzypczak/ttrpg-agents/issues/219).

## 219.1 The image hash reaches the art row through a second `token-art-set`, sent after the upload answers

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: Since #218, setting art without a hash clears the hash, and `token_art` refuses a hash that has no stored image (foreign key), so the row can get the hash only after the bytes are stored. Since #209/#224 no snapshot answers a `token-art-set`, so the extension learns the hash from the upload route's answer (maintainer, comment on #219).
- Options:
  - Chosen: two `token-art-set` messages. The link is sent at pick time, as before, and the tokens are created at once. The upload runs outside the reconcile chain. On success the extension adds the hash to its in-memory art for the type and sends a second `token-art-set` with `sha256` (a full upsert). The wire shape does not change, and the outbox keeps the two messages in order.
  - One `token-art-set`, held until the upload settles: one write fewer, but a slow or hung fetch delays storing the link, and a reload in between loses the pick.
  - The upload route links the image to a monster key: this couples the image route to monster keys, against the maintainer's rule that the image store is decoupled from monsters (epic #217), and the art row may not exist yet, because HTTP and the WebSocket are separate channels.
- Where: `createEncounterSync` options `storeImage` and `onArtStoreFailed` (`packages/owlbear/src/encounter-sync.ts`); `tokenArtMessage` and `uploadTokenImage` (`packages/owlbear/src/token-art.ts`); `docs/architecture.md` (Who owns what, Token art per monster type).
- Revisit if: art is written by anything other than the extension's pick (#220 republish, #221 import), or the cost of the extra write matters.
- Status: active

## 219.2 Validate-then-save is an engine use case, `storeTokenImage`

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The bridge route must store only bytes that pass `validateTokenImage`, and the local library import (#221) will store bytes too.
- Options:
  - Chosen: `storeTokenImage(repo, bytes)` in the engine validates the bytes, saves them only when they pass, and answers the hash and image info or the validation error. One place guarantees that only validated bytes are saved ("the engine computes it", CLAUDE.md Architecture).
  - A validate-then-save helper inline in the bridge: about ten lines less API, but each caller must remember to validate.
- Where: `storeTokenImage`, `TokenImageStoreResult` (`packages/engine/src/encounter/token-image.ts`); `storeTokenImage` hook (`packages/bridge/src/server.ts`, wired in `packages/bridge/src/cli.ts`).
- Status: active

## 219.3 The upload route takes the raw image as the body, capped at exactly 1 MiB, with the extension token as bearer and typed refusals

- Decided by: work-ticket orchestrator (#219), 2026-10-25, plan (approved by the epic #217 orchestrator), not human-approved.
- Context: The ticket asked for a cap of "the image size cap plus a small margin" and for typed errors. The maintainer ruled out the WebSocket for bytes and any URL on the route (#182).
- Options:
  - Chosen: `POST /token-images` (an exact path, so no query string is accepted), checked after the global Host check, with no CORS headers. The extension is served by the bridge, so its request is same-origin. The extension token is checked as a bearer before the body is read, and the agent token is refused (401). The raw body is capped at exactly `TOKEN_IMAGE_MAX_BYTES` (413 `too_large`), because it has no envelope for a margin to cover. A validation refusal is 422 with the engine's code, and a failing store is 500 `store_failed`, snake_case like the engine's codes. The claimed Content-Type is ignored. The response shape lives in `protocol`.
  - A body cap with a margin: nothing to cover with a raw body.
  - A `store-failed` code in the bridge's kebab-case style: it would mix two styles in one enum that clients match on.
- Where: `TOKEN_IMAGE_UPLOAD_PATH`, `tokenImageUploadResponseSchema` (`packages/protocol/src/protocol.ts`); the route handler in `packages/bridge/src/server.ts`; `docs/architecture.md` (Token and auth).
- Status: active

## 219.4 A failed fetch or upload of picked art is tried once, and its panel error stays until the panel reloads

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved; flagged to the maintainer for veto.
- Context: The ticket asks that a failure not block the pick, be shown in the panel and not be retried in a loop. The panel clears its other command errors at the next store change, which fires on every `mcp` event, and a pick usually follows an MCP add plus more changes.
- Options:
  - Chosen: one attempt per pick. The error (`Could not store the image of the token art for <monsterKey>; it is kept as a link: <reason>`) stays until the panel reloads, and a later art failure replaces it. Nothing retries, so the fact stays true all session, and no new UI is needed.
  - A dismiss button, like the override list: more UI.
  - Clear the error at the next store change, like a refused token deletion: it may vanish before the GM sees it.
- Where: `onArtStoreFailed` (`packages/owlbear/src/encounter-sync.ts`); `PanelInput.artError` (`packages/owlbear/src/panel-state.ts`); `packages/owlbear/src/main.ts`.
- Revisit if: the maintainer vetoes it, or failures turn out common enough to need a retry.
- Status: active

## 219.5 Art without stored bytes is not backfilled in this ticket

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: Art picked before this ticket, or whose upload failed, has no stored bytes, and #220's republish cannot restore it.
- Options:
  - Chosen: out of scope here. Follow-up #250 stores the bytes of such rows while their URL is alive (blocked by #220's liveness check).
  - No follow-up: such art never gets bytes.
- Where: #250.
- Status: active

## 219.6 An upload's hash is applied while the type's art is still the same picture by value, not the same object

- Decided by: implementer, 2026-10-25, implementation (accepted by the work-ticket orchestrator), not human-approved.
- Context: The upload answers after the pick, and a snapshot can replace the in-memory art for the type in the meantime (a reconnect brings back the same stored art as a new object).
- Options:
  - Chosen: compare url, mime, width and height (`samePicture`). The same art brought back by a snapshot still gets the hash and the second `token-art-set`. Art that changed to another picture gets neither.
  - Compare by object identity: a reconnect snapshot during the upload would drop the hash, and the art row would stay unlinked.
- Where: `samePicture` and the upload in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `packages/owlbear/src/encounter-sync-art-upload-guards.test.ts`.
- Status: active
