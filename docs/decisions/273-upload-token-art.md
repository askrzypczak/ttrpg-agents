# feature: upload new token art from the extension panel

Issue: [#273](https://github.com/askrzypczak/ttrpg-agents/issues/273).

## 273.1 Every Token art row has "Upload new art" (one file input in the panel page) and, once a file is uploaded, "Pick the uploaded image"; nothing waits on them

- Decided by: maintainer (epic #326 body, 2026-10-31, M1 and M6) for the scope (any type #274's Token art list shows, so a wrong pick can be fixed with a new file) and the pattern (310.1's list and GM-started buttons, not `pickUploadedArt`); the row placement and the single input are the epic #326 orchestrator's, 2026-10-31, plan gate, not human-approved.
- Context: a type with no usable art in the GM's Owlbear library could only stay circles; the panel had no way to bring a local image file in. `uploadImages` resolves when Owlbear's folder dialog opens and a cancel gives no signal (220.1, 310.1), so the upload and the pick are two GM steps.
- Options:
  - Chosen: each `#type-art-list` row, in all four states (`none`, `declined`, `art`, `reupload`), gains "Upload new art", which opens the file chooser of one hidden `#art-file` input in the panel page, and, once the chosen file is uploaded, "Pick the uploaded image" with a hint naming the asset (the re-upload row's text). `EncounterSync.uploadArtFile` uploads the file and opens no picker; `EncounterSync.pickUploadedFile` opens the picker on it. Both run outside the reconcile chain and nothing waits on them. The pending upload is session-only: after a reload the GM uploads again (310.11).
  - One button that uploads and opens the picker at once: the asset is not in the library before the GM confirms the folder, so the picker would not find it.
  - Reuse `pickUploadedArt`: it returns early unless the type is on the re-upload list with a stored hash, and keeps that hash (M6).
  - One file input per row: rows are redrawn when the list changes, and a redraw while the chooser is open would detach the input.
- Where: `uploadArtFile`, `pickUploadedFile`, `fileUploads`, `TypeArt.uploadedAs`, `typeArtList` (`packages/owlbear/src/encounter-sync.ts`); `PanelView.typeArt` (`packages/owlbear/src/panel-state.ts`); `drawTypeArt` and the `#type-art-list` and `#art-file` listeners (`packages/owlbear/src/main.ts`); `#art-file`, `#type-art` (`packages/owlbear/index.html`).
- Status: active

## 273.2 A chosen file is uploaded under `ttrpg-art-` and the first 16 hex characters of the SHA-256 of its bytes, hashed in the panel with Web Crypto

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q1), not human-approved.
- Context: the pick step searches the GM's library for the uploaded asset by name, so the name must find that image and not others; the re-upload already names its asset `republishName` of the stored bytes' hash (220.7).
- Options:
  - Chosen: `republishName` of the SHA-256 of the file's bytes, via `crypto.subtle.digest` (a browser and Node 24 global, no dependency). One naming scheme with the re-upload, unique per image, so the search lists only that image or identical copies. The name is opaque to the GM; `storePicked` later stores Owlbear's copy, whose hash may differ, so a later re-upload uses another name (harmless).
  - The file's own name without its extension: recognisable, no hashing, but the search may also list other assets whose names contain it, and two different files with the same name both match.
  - `ttrpg-art-<monsterKey>`: recognisable, no hashing, but every earlier upload for the type matches too, so a GM fixing a wrong upload sees the wrong one again; 220.7 rejected a monster-key name for re-uploads.
- Where: `uploadArtFile` (`packages/owlbear/src/encounter-sync.ts`); `republishName` (`packages/owlbear/src/token-art.ts`).
- Status: active

## 273.3 The chosen file is not checked before the upload; the pick's schema and the store's limits apply as for any pick

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q2), not human-approved.
- Context: the ticket asks to validate with the existing token art schema and the bytes limits already applied to picks. A pick is validated by `publishedTokenArtSchema`, and its bytes by the bridge's store limits (1 MiB, PNG, JPEG or WebP, 2048 px; `validateTokenImage`) when `storePicked` stores Owlbear's copy.
- Options:
  - Chosen: no new check. The pick of the uploaded image goes through the same `pickArt` and `storePicked` as any panel pick; the file input's `accept` lists the store's three types. A file the store refuses still draws, kept as a link with the existing "Could not store the image ..." error.
  - Check the file with the engine's `validateTokenImage` before uploading: the GM learns early, but it is stricter than Pick art (Owlbear's re-encoded copy might fit where the original does not), and adds `image-size` to the extension bundle.
- Where: `uploadArtFile`, `pickUploadedFile` (`packages/owlbear/src/encounter-sync.ts`); `#art-file` (`packages/owlbear/index.html`).
- Status: active

## 273.4 The pick of an uploaded file goes through `takePanelPick` with no hash, so it is stored like a fresh pick; any valid panel pick for the type ends the pending upload's pick

- Decided by: maintainer (epic #326 body, 2026-10-31, M6) for storing the new image like a fresh pick; ending the pending pick on any valid panel pick is the epic #326 orchestrator's, 2026-10-31, plan gate, not human-approved.
- Context: #274's `takePanelPick` (274.2) already makes a panel pick the type's art, sends it, stores its bytes when it has no hash, wins over a stale snapshot and redraws the type's tokens through `reskins` (274.3).
- Options:
  - Chosen: `pickUploadedFile` hands a valid pick to `takePanelPick` with no `sha256`, so `storePicked` fetches its bytes from Owlbear and stores them on the bridge, and the art is sent again with their hash; a `reupload` type leaves the re-upload list. `takePanelPick` also deletes the type's pending upload, so after any valid panel pick for the type (Pick art, the re-upload pick or the upload's pick) its row no longer offers "Pick the uploaded image". A cancelled, failed or invalid pick keeps the pending upload, so the GM can press again.
  - Keep the pending upload after a pick: the row would keep asking the GM to pick an image they already picked, as 274.2 avoids for a picked re-upload type.
- Where: `pickUploadedFile`, `takePanelPick`, `fileUploads` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 273.5 A file that cannot be read or uploaded is reported through `onArtRepublishFailed` with its own text

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (plan assumption), not human-approved.
- Context: the panel already shows the re-upload's failures from `onArtRepublishFailed` as an error.
- Options:
  - Chosen: "Could not upload the new token art for <monster name>: <reason>" through `onArtRepublishFailed`, whose doc widens to cover it. The type's art, tokens and pending upload stay as they were, and the GM can choose a file again.
  - A new option for upload failures: one more callback and panel wiring for the same error display.
- Where: `uploadArtFile`, `onArtRepublishFailed` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 273.6 The upload and its pick share `inflight` and 274.6's guards

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q3), not human-approved.
- Context: the panel rows redraw only when the list changes, so a double click could stack two folder dialogs and two asset copies (310.12); 274.7's skip of the fresh picker for a type relies on the shared set.
- Options:
  - Chosen: `uploadArtFile` and `pickUploadedFile` return at once for a type not in the Token art list, one in the shared `inflight` set (an upload, a pick of the uploaded image, a re-upload, its pick or Pick art still running), or one whose fresh picker is open or queued; `pickUploadedFile` also for a type with no upload this session. Pick art and the re-upload buttons already ignore a type in `inflight`, so they ignore it during its upload too.
  - No guard: a double click opens two folder dialogs and uploads two copies.
- Where: `inflight`, `picking`, `uploadArtFile`, `pickUploadedFile` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
