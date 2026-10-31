# chore: document that a deleted Owlbear asset reads as gone only after a delay

Issue: [#323](https://github.com/askrzypczak/ttrpg-agents/issues/323).

## 323.1 A stored url is gone when a no-cache GET answers 4xx, which after a deletion can take hours; the check stays and the delay is accepted

- Decided by: maintainer (#323 body, 2026-10-31), on the recommendation of spike #275; wording by the work-ticket orchestrator, 2026-10-31, plan gate.
- Context: 220.2 said the GET with `cache: "no-cache"` revalidates with the server. Spike #275 ([findings](https://github.com/askrzypczak/ttrpg-agents/issues/275#issuecomment-6538453778)) measured one asset deleted from the GM's library: its url answered 200 for at least 6 minutes and read as gone under about 18 hours after the deletion (answer 1). A `no-cache` GET right after a plain one answers `cdn-cache: HIT`, so the request stops at the CDN's edge (BunnyCDN) and does not reach Owlbear's origin; it still gets past the browser's own 3-day cache (answer 2). A gone asset answers HTTP 400 with the JSON body `{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}`, the same as a url that never existed (answer 1).
- Options:
  - Chosen: keep 220.2's rule (GET with `cache: "no-cache"`; 2xx alive, 4xx gone, a network error or any other status cannot tell and keeps the stored art) and accept the delay. While the url answers 200 the art still draws for everyone, so a late detection costs nothing; once it stops, the next session's check lists the type for re-upload (310.1, 310.2). The 400 is a 4xx and carries `access-control-allow-origin: *`, so the extension reads it as gone. A url that stops answering mid-session is found at the next reload, and tokens already drawn with it can show "Image Unavailable" until the GM re-uploads (inferred, spike #275).
  - Ask Owlbear whether the asset is still in the library: no SDK call can tell; `OBR.assets` only uploads and downloads, and the library is readable only through the GM's picker (answer 6).
  - A request that gets past the CDN's edge: none is known; the edge does not pass the client's `no-cache` on (answer 2).
- Where: `ObrAdapter.isImageAlive` (`packages/owlbear/src/obr-adapter.ts`); the liveness check in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: the delay causes trouble at the table, or a token still using the image is shown to hold the url alive (spike #275, answer 3: not measured).
- Status: active
- Supersedes: 220.2

## 323.2 The e2e fake answers a deleted asset's url with the CDN's real 400 and JSON body

- Decided by: maintainer, 2026-10-31, plan gate.
- Context: `storedUrlGone` and the restore test of gone art routed the stored url to a 404 "as for an asset deleted from the library"; the CDN really answers a 400 with a JSON `NoSuchKey` body (spike #275, answer 1). `isImageAlive` reads both as gone. The restore test was found during implementation and added with the maintainer's approval.
- Options:
  - Chosen: route a 400 with the CDN's JSON body and `access-control-allow-origin: *`, so the fakes match what was measured; the README's e2e notes say so.
  - Keep the 404: the tests stay valid (both are 4xx), but their comments and the README's e2e notes would record an answer the CDN does not give.
- Where: `storedUrlGone` (`packages/owlbear/e2e/token-art.e2e.ts`); the gone stored url in the restore test of `packages/owlbear/e2e/restore.e2e.ts`; the e2e notes in `packages/owlbear/README.md`.
- Status: active
