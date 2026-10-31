# feature: republish stored token art to Owlbear when its asset is gone

Issue: [#220](https://github.com/askrzypczak/ttrpg-agents/issues/220).

## 220.1 The picker opens when the GM presses a panel button after the upload dialog, not right after the upload call

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved; flagged to the maintainer for veto.
- Context: `OBR.assets.uploadImages` resolves as soon as Owlbear's "Select Folder" dialog opens, before the GM confirms it (spike #182, answer 1), and nothing in the SDK says when the uploaded asset exists. The maintainer's epic text counts two GM dialogs (folder, then pick); this adds one panel click between them.
- Options:
  - Chosen: GM-paced. After the upload call the panel opens itself (`OBR.action.open()`) and shows what is asked (confirm the folder, then press "Pick the uploaded image" and select the image with the hash-derived name); the button opens the picker with that name as the default search. The reconcile waits for the GM, as it waits on the picker today. It works whatever Owlbear does with two dialogs at once.
  - The picker right after the upload call, as the ticket text reads: no extra UI, but the asset is probably not in the library yet (or the picker covers the folder dialog), so the search finds nothing; the fakes would pass while the real table fails.
  - A live check in the test room first: interactive, and leaves test assets in the maintainer's library; the chosen option works either way.
- Where: option `awaitUploadConfirmed` (`packages/owlbear/src/encounter-sync.ts`); `ObrAdapter.openPanel` (`packages/owlbear/src/obr-adapter.ts`); `PanelInput.artPrompt`, `PanelView.prompt` (`packages/owlbear/src/panel-state.ts`); `#art-prompt`, `#pick-art` (`packages/owlbear/index.html`, `packages/owlbear/src/main.ts`).
- Revisit if: Owlbear is observed to accept the picker right after `uploadImages`, or the maintainer prefers two dialogs with no panel step.
- Status: superseded by 310.1

## 220.2 A stored url is dead when a revalidating GET answers 4xx; anything but 2xx or 4xx cannot tell and keeps the stored art

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The republish must run only when the Owlbear asset is gone. Owlbear asset urls are public with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=259200` (spike #182), so a browser-cached copy could hide a deletion.
- Options:
  - Chosen: GET with `cache: "no-cache"` (revalidates with the server). 2xx is alive, 4xx is dead, a network error or any other status cannot tell and uses the stored art with no dialog.
  - HEAD: no body, but HEAD support on the CDN is unverified, and a 405 would read as dead and prompt for nothing.
  - Any non-2xx answer or network error as dead: prompts the GM on a flaky network.
- Where: `ObrAdapter.isImageAlive` (`packages/owlbear/src/obr-adapter.ts`); the check in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: superseded by 323.1

## 220.3 Stored bytes that cannot be loaded from the bridge give the circle and a panel error until reload

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved (an AC addition).
- Context: The ticket treats a cancel or a picker error as "no art"; it does not say what happens when the bridge cannot serve the stored bytes.
- Options:
  - Chosen: circle tokens, not asked again this session, and `Could not republish the token art for <monsterKey>: <reason>` in the panel's art error slot until the panel reloads (the lifetime of 219.4).
  - A silent circle: the GM would not know why the art went missing.
- Where: option `onArtRepublishFailed` (`packages/owlbear/src/encounter-sync.ts`); `artError` in `packages/owlbear/src/main.ts`.
- Status: superseded by 310.4

## 220.4 The re-picked asset is trusted as the re-uploaded image and keeps the stored hash

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The picker lets the GM select any image; the default search lists the re-uploaded one first. The maintainer asked that the republish send the existing `sha256` with the re-picked art (comment on #220).
- Options:
  - Chosen: trust the pick and attach the stored hash, sent as one `token-art-set`. The re-encoded Owlbear copy is not fetched or stored: the original bytes stay the source of truth.
  - Compare the pick's width and height with the dead art's and treat a mismatch as a fresh pick: Owlbear re-encodes uploads and nothing says it never resizes, so a mismatch could unlink the original bytes and store the re-encoded copy instead.
- Where: the republish step in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 220.5 The liveness of a type's stored art is checked once per session

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The check runs before tokens of a type are created. The ticket's once-per-session rule is for the ask; the check could run more often.
- Options:
  - Chosen: once per type per session, like `needsArt`; a type picked this session counts as checked. One revalidating request per type; an asset deleted mid-session is caught at the next reload.
  - On every reconcile that adds tokens of the type: one revalidating fetch per such reconcile, for a rare event.
- Where: the `checked` set in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: #250 needs a different cadence for art without stored bytes.
- Status: superseded by 310.2

## 220.6 The bridge serves stored bytes at `GET /token-images/<sha256>`, authenticated like the upload route

- Decided by: work-ticket orchestrator (#220), 2026-10-25, plan (approved by the epic #217 orchestrator), not human-approved.
- Context: The extension needs the stored bytes to upload them to Owlbear; bytes never go over the WebSocket (maintainer, #182). 219.3 set the rules for the upload route.
- Options:
  - Chosen: `GET /token-images/<sha256>` after the global Host check, extension token as bearer checked first (agent token refused, 401 `unauthorized`), exactly 64 lowercase hex characters and no query string, else 404 `not_found`, as is a hash not stored. The success body is the raw bytes with the stored mime as Content-Type and `X-Content-Type-Options: nosniff`. No CORS headers (the panel is same-origin). Typed refusals in `protocol` (`tokenImageReadErrorSchema`); the path from `tokenImagePath`. It reads through the engine port `TokenImageRepository.getTokenImage`, wired in the composition root. A store that throws drops the connection, with no new refusal code (implementer).
  - A 400 for a malformed hash: one more code for a request that can only mean "not stored".
  - An engine use case for the read: no rule to put in it.
- Where: `handleTokenImageRead` and option `getTokenImage` (`packages/bridge/src/server.ts`, wired in `packages/bridge/src/cli.ts`); `tokenImagePath`, `tokenImageReadErrorSchema` (`packages/protocol/src/protocol.ts`); `downloadTokenImage` (`packages/owlbear/src/token-art.ts`).
- Status: active

## 220.7 A republished image is uploaded under a name derived from its hash

- Decided by: work-ticket orchestrator (#220), 2026-10-25, plan (approved by the epic #217 orchestrator), not human-approved.
- Context: The picker's default search must find the re-uploaded asset; the image store knows nothing about monsters (maintainer, epic #217).
- Options:
  - Chosen: `ttrpg-art-` plus the first 16 hex characters of the SHA-256, the asset name in the GM's library and the default search. #223 reuses it.
  - The full 64-character hash: unique beyond doubt, but long in the GM's library and the search box.
  - A name with the monster key: easier to recognise, but couples the image to one monster type.
- Where: `republishName` (`packages/owlbear/src/token-art.ts`).
- Status: active

## 220.8 Republished art is kept for the session over the art a later snapshot carries

- Decided by: reviewer, 2026-10-25, review round 1 (applied by the work-ticket orchestrator), not human-approved.
- Context: The bridge sends a snapshot right after each `hello-ack`, built before a queued `token-art-set` reaches the store. A republish whose `token-art-set` waited for a reconnect (or was lost on a dropping connection) would see that snapshot put the dead art back in memory, and the type, already checked, would draw later tokens with the dead url.
- Options:
  - Chosen: the sync keeps each type's republished art for the session and lays it over the art it plans with, so a snapshot carrying the dead art does not replace it.
  - Check the type again after each snapshot: one more request and possibly a second upload and pick for the same image.
  - Leave it: rare (needs a socket drop around the pick), but the tokens then show "Image Unavailable" for the rest of the session.
- Where: `republished` and `usableArt` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); test "a stale snapshot after a republish keeps the republished art" (`packages/owlbear/src/encounter-sync-art-republish.test.ts`).
- Revisit if: art can change from another source during a session (#221 import), which the overlay would hide until reload.
- Status: active
