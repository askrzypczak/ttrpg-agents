# feature: token art without an Owlbear URL, published on first use

Issue: [#223](https://github.com/askrzypczak/ttrpg-agents/issues/223).

## 223.1 Token art carries its published reference all or nothing: url, mime, width and height are all present, or all absent with an image hash

- Decided by: epic #217 orchestrator, 2026-10-25, launch brief, not human-approved.
- Context: Art can now exist as stored bytes that were never published to Owlbear (for example from the local library import, #221). The ticket left open whether mime, width and height are also absent until the first publish.
- Options:
  - Chosen: all or nothing. `TokenArt` is either `PublishedTokenArt` (`url`, `mime`, `width`, `height`, optional `sha256`) or a hash alone. Mime, width and height describe the published Owlbear asset, which Owlbear re-encodes on upload; the stored bytes keep their own mime and size in `token_art_image`.
  - Optional url alone, with mime, width and height kept: art without a url would carry the stored bytes' mime and size, which the published asset may not share.
  - A separate table for URL-less assignments: two tables to read for a snapshot, and a rule for which one wins.
- Where: `PublishedTokenArt`, `TokenArt`, `publishedTokenArtSchema`, `tokenArtSchema` (`packages/engine/src/encounter/token-art.ts`); migration 8 (`packages/store-sqlite/src/migrations.ts`).
- Status: active

## 223.2 Migration 8 rebuilds `token_art` with nullable reference columns and a table CHECK

- Decided by: work-ticket orchestrator (#223), 2026-10-25, plan (approved by the epic #217 orchestrator), not human-approved.
- Context: SQLite cannot alter the `CHECK (url LIKE 'https://%')` and `NOT NULL` constraints of migration 3. Spike #182 said the check has to be relaxed or the row kept apart from the stored bytes.
- Options:
  - Chosen: create a new table with `url`, `mime`, `width` and `height` nullable (their column CHECKs kept; they pass on NULL), the same `sha256` foreign key, and a table CHECK: all four set, or all four NULL with `sha256` set. Copy the rows, drop the old table, rename the new one, inside the migration's transaction. No table refers to `token_art`, so foreign keys stay on.
  - A separate table for URL-less assignments: see 223.1.
  - A sentinel url for art never published: false data that every reader must recognise.
- Where: migration 8 (`packages/store-sqlite/src/migrations.ts`); `SqliteTokenArtRepository` (`packages/store-sqlite/src/token-art-repository.ts`).
- Status: active

## 223.3 `token-art-set` still requires a published reference

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The snapshot's art map reuses `tokenArtSchema`, which now accepts a hash alone; `token-art-set` reused it too. Every sender of `token-art-set` (a fresh pick, the #220 republish, #250) has a url, and #221 writes rows through the repository, not over the wire.
- Options:
  - Chosen: `token-art-set` uses `publishedTokenArtSchema`. `setTokenArt` is a full upsert, so a URL-less set over the wire could erase a published url.
  - Keep the union on `token-art-set`: no protocol change, but the extension could unpublish art by mistake.
- Where: `tokenArtSetPayload` (`packages/protocol/src/protocol.ts`); `tokenArtMessage` (`packages/owlbear/src/token-art.ts`).
- Status: active

## 223.4 The extension never draws or freshly picks art without a url; it publishes it through the republish path, with no liveness check

- Decided by: work-ticket orchestrator (#223), 2026-10-25, plan (approved by the epic #217 orchestrator), not human-approved.
- Context: #220's republish uploads stored bytes and asks the GM to pick them; the ticket treats a missing url like a dead one.
- Options:
  - Chosen: `planSync` takes only published art (a compile-time guarantee), and `usableArt` leaves URL-less art out, so its type plans as circles. The fresh-pick loop skips a type that has stored art, since a fresh pick would drop the link to the stored bytes. `checkStoredArt` sends art without a url straight to `republish`, under the same once-per-session gate, before anything is written. The prompt and failure texts stay as #220 wrote them ("republish" covers a first publish too).
  - Treat a type with URL-less art as having no art: the GM would get the plain picker, and the pick would replace the stored bytes' link.
  - Draw URL-less art from the bridge's `GET /token-images/<sha256>`: works for the GM only (spike #182, answer 2).
- Where: `usableArt`, `checkStoredArt` and the fresh-pick loop in `apply` (`packages/owlbear/src/encounter-sync.ts`); `planSync`, `SyncConfig.tokenKind` (`packages/owlbear/src/sync-plan.ts`).
- Revisit if: art can change from another source during a session (#221 import while the extension runs): a type picked, checked for liveness, published or declined this session is not checked again, so art without a url arriving later for it stays circles until reload.
- Status: active
