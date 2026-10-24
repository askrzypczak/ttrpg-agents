# Owning the token art bytes (spike #182)

Token art is stored as a reference, `{ url, mime, width, height }`, where `url` is whatever Owlbear's asset picker returned (`pickImage` in `packages/owlbear/src/obr-adapter.ts`; table `token_art`, migration 3). If the asset is deleted, or the table moves to another VTT, the reference is dead and nothing in our database can recreate the image. This spike asks whether the project should own the image bytes, and how.

Run on 2026-10-24 against the room "ttrpg-agents-test", SDK `@owlbear-rodeo/sdk` 3.1.0 (the version in `packages/owlbear/package.json`), Chrome 147, GM client only. Experiment code was throwaway and is not committed. Every answer says whether it was **observed** (run in the room), **read** (SDK source, response headers or repo code) or **inferred**.

## Recommendation

Own the bytes, locally, and treat the Owlbear URL as a cache of them.

- Store the bytes in the shared SQLite file, in a new table separate from `token_art`, after validating them (see "Answers", question 4 and 5). The existing `token_art` row stays the VTT-side reference; it gains nothing VTT-specific beyond a link to the stored bytes.
- The extension obtains the bytes in the browser and posts them to the bridge over HTTP. The bridge never fetches a URL it was given.
- Owlbear stays the only publisher for now. To put an image on a scene for remote players, the Owlbear adapter uploads the bytes with `OBR.assets.uploadImages` and reads the stored URL back through the asset picker. It re-uploads when the stored URL has died.
- Do not build a VTT-neutral publishing abstraction yet (near-term scope is the D&D proof of concept on Owlbear). Keep the bytes and the adapter's publish step separate so a second VTT only needs its own publish step.
- Tony's idea of a separate workflow that fills a local image library (not on GitHub, like the monster data) fits as one more source of bytes into the same table. It does not change the storage or publish design. See follow-up 4.

Why not the alternatives:

- Reference only (today): cannot recover from a deleted asset or a VTT change.
- A URL on the local bridge: works for the GM only (answer 2 and 3).
- A public host we run: gives remote players a stable URL, but needs hosting, CORS and a place for Tony's art to live publicly. Not justified while Owlbear's own store already serves the images publicly.
- `data:` URLs on the item: impossible (answer 2).

## Answers

### 1. What does `OBR.assets.uploadImages` do, and how does the code learn the stored URL?

- **Read**: `uploadImages(images: ImageUpload[], typeHint?)` returns `Promise<void>` and only sends the message `OBR_ASSETS_UPLOAD_IMAGES` (`lib/api/AssetsApi.js`). Public docs describe it as opening a folder picker ([docs.owlbear.rodeo](https://docs.owlbear.rodeo/extensions/apis/assets)).
- **Observed**: it prompts the GM. The call resolved after 24 ms with `undefined`, while Owlbear showed a "Select Folder" dialog (tabs Maps, Props, Mounts, Characters, Attachments, Notes; the `typeHint` `CHARACTER` preselected Characters) in the main window, with an "Upload images" button. The upload only happened after I clicked it, so the resolved promise says nothing about whether the GM confirmed or cancelled. What a cancel looks like was not observed.
- **Observed**: there is no returned URL or id. The only way to learn the stored asset is to ask the GM to pick it: `downloadImages(false, "<name>", "CHARACTER")` opened the picker with the name prefilled, listed the new asset first, and returned after the GM clicked Select:
  `{ name, type: "CHARACTER", image: { width: 128, height: 128, mime: "image/webp", url: "https://images.owlbear.rodeo/<account uuid>/items/<uuid>.webp" }, grid: { dpi: 128, offset: { x: 64, y: 64 } } }`.
- **Observed**: Owlbear re-encodes. A 128x128 PNG went in and an `image/webp` of the same size came out (1240 bytes). The stored mime therefore differs from the uploaded one, and the stored bytes are not the uploaded bytes.
- Cost per image on Owlbear: two GM dialogs (folder, then pick), and the asset lands in the GM's library (and counts against their storage).
- **Observed side effect**: my test image `spike182-upload` (128x128) is still in the "Characters" folder of Tony's library. It has to be deleted by hand in the Owlbear asset manager; I did not delete it.

### 2. Which URLs can a scene image item use, and do other players load them?

Observed on the GM client, by adding image items and looking at the scene (an unloadable item renders as an "Image Unavailable" card):

| URL                                                                   | Result                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `https://placehold.co/256.png` (foreign host, sends CORS)             | loads                                                                                 |
| `https://httpbin.org/image/png` (foreign host, sends CORS)            | loads                                                                                 |
| Owlbear asset URL (`images.owlbear.rodeo`)                            | loads                                                                                 |
| `http://localhost:<port>/x.png` with `Access-Control-Allow-Origin: *` | loads                                                                                 |
| `http://localhost:<port>/x.png` without CORS headers                  | "Image Unavailable" (the request reached my server; the response was refused)         |
| `http://127.0.0.1:<port>/x.png` with CORS                             | "Image Unavailable" (no request reached my server)                                    |
| `data:image/png;base64,...` (222 characters)                          | "Image Unavailable"                                                                   |
| `data:` URL longer than 2048 characters                               | `addItems` rejected: `"items[2].image.url" length must be less than or equal to 2048` |

Why (**read** and **inferred**): Owlbear's page sends the policy `img-src 'self' https: data: blob: http://localhost:*` and `connect-src 'self' wss: https: blob: http://localhost:*`. The results fit items being loaded with a fetch-style request that `connect-src` governs (no `data:`, no `127.0.0.1`) and that needs CORS headers on the response. A `fetch` of a `data:` URL and of the 127.0.0.1 URL from the Owlbear page itself failed, and the localhost one succeeded, which matches the table. That Owlbear loads items this way is inferred from those results, not read from its code.

Consequences:

- `data:` URLs are unusable. The 2048 character cap already rules out any real image (about 1.4 KB of bytes at most), and `connect-src` rules out `data:` anyway. `tokenArtSchema` (`packages/engine/src/encounter/token-art.ts`) already caps `url` at 2048 and requires `https`.
- Any https host that sends `Access-Control-Allow-Origin` works for the GM. No size limit on the image was hit; none was probed.
- A bridge URL works for the GM only (it needs `http://localhost`, and CORS headers the bridge does not send today; `ALLOWED_ORIGINS` in `server.ts` is for its own routes).
- **Inferred, not observed**: remote players load the same URLs. Items are fetched client-side by the same Owlbear web app and the same CSP for every role, so a player can load any public https URL that sends CORS headers and can never load the GM's `localhost`. I did not run a player client (a second browser was not available; the room's only other member was an idle guest whose extension did not connect). A follow-up could verify it (see follow-up 5).
- **Read**: an Owlbear asset URL is public and unauthenticated. `curl` without cookies returns 200 with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=259200`. The URL contains the owner's account UUID.

### 3. Where can we host bytes that remote players can reach, if the VTT will not host them?

The VTT will host them, through question 1's route. If we do not want that:

| Option                                           | Reaches remote players | Cost                                                                                    |
| ------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| Owlbear asset store (upload, then pick back)     | yes (public CDN)       | two GM dialogs per image; counts against the GM's storage; bytes re-encoded to webp     |
| Bridge on loopback                               | no (GM only)           | bridge must add CORS for Owlbear; fine as a GM-only fallback                            |
| A tunnel to the bridge (for example cloudflared) | yes                    | extra process; exposes the bridge's routes publicly; ties images to the bridge being up |
| A public static host or bucket with CORS         | yes                    | an account, hosting and publishing step; art is public. **Not tried**                   |
| `data:` URL                                      | no                     | impossible (question 2)                                                                 |

Recommendation: the Owlbear asset store, with our copy of the bytes as the source of truth.

### 4. Which side obtains the bytes, and how are they validated?

- **The extension fetches the bytes in the browser and posts them to the bridge.** The bridge must not fetch a client-supplied URL: that is a server-side request forgery surface, and the extension token only proves who asked, not that the target is safe. The extension can read the Owlbear asset URL with `fetch` because the CDN sends `Access-Control-Allow-Origin: *` (**read** from the headers; a `fetch` from the extension iframe itself was not run).
- **Use an HTTP upload route, not the WebSocket.** The WebSocket is capped at 1 MiB per message (`maxPayload` in `packages/bridge/src/server.ts`), and base64 costs a third on top. A `POST /art/<monsterKey>` with the extension token, a body cap, `Host` check and the usual loopback rules carries a binary body directly.
- **Validate on the bridge, never trust the client's claims:**
  - detect the type from magic bytes (PNG, JPEG, WebP; allow GIF only if a first frame is wanted), ignore the claimed mime, and refuse SVG (scriptable) and anything else;
  - read width and height from the header and cap them (2048 px on the longer side);
  - cap the byte size (below);
  - store a SHA-256 of the bytes so identical images share a row and a republish can tell whether the VTT copy matches.
- The existing flow stays: the GM picks the art once per monster type; the extension then fetches the picked URL's bytes and sends them. Nothing about the picker changes.

### 5. Size limit and storage shape in SQLite

- Measured: a 128x128 image is 1.2 KB as WebP. Token art is drawn within 1 to 4 cells; at the 150 dpi grid in the test scene a 4-cell token needs about 600 px, so 1024 px on the longer side is ample and 2048 px is a generous cap.
- Suggested limits: 1 MiB per image, 2048 px longer side. A few hundred monster types at tens to a few hundred KB each is tens of MB at most.
- Shape: a new table `token_art_image (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL)` with `token_art` pointing at it by `sha256`, so listing art for a snapshot never reads blobs. Keep the bytes out of snapshots: the bridge polls `PRAGMA data_version` every 250 ms and broadcasts a snapshot after any commit by another process, which stays cheap as long as snapshots carry references and not bytes.
- Files on disk (content addressed under the data directory) were considered. SQLite's own measurements say small blobs (about 100 KB and under) read faster from the database than as files ([sqlite.org/fasterthanfs.html](https://sqlite.org/fasterthanfs.html), not re-measured here), and one file stays the only thing to back up and the only thing the MCP and the bridge both open. Use files only if images turn out to be large.
- The existing `CHECK (url LIKE 'https://%')` on `token_art` has to be relaxed or the row kept separate from the stored bytes: an image we own has no VTT URL until it is published.

## Follow-up tickets

1. **Store and validate token art bytes** (feature): engine port `TokenImageRepository`, validation module (magic bytes, dimensions, size cap, SHA-256), migration adding `token_art_image` and a `token_art.sha256` link, SQLite adapter. Blocked by: none.
2. **Bridge `POST /art/<monsterKey>` route and extension upload** (feature): the extension fetches the picked image's bytes in the browser and posts them to the route with the extension token; the bridge validates and stores them. Never fetches a URL. Blocked by: 1.
3. **Owlbear adapter: republish stored art when its URL is dead** (feature): check liveness of the stored URL (extension `fetch`), otherwise upload the stored bytes with `uploadImages` and read the URL back with the picker, then update the `token_art` reference. Handles that `uploadImages` resolves before the GM confirms. Blocked by: 2.
4. **Local image library import** (feature): a local command or folder import that fills `token_art_image` from files (monster key to image), not committed to GitHub like the monster data; any adapter's publish step uses it. This is Tony's separate-workflow idea. Blocked by: 1.
5. **Verify image loading on a player client** (chore, interactive): repeat the question 2 table in a player's browser (incognito window) and confirm players load Owlbear asset URLs and a public https URL, not localhost. Needs a second browser; not for unattended agents. Blocked by: none.

Not filed: a public static host or tunnel. Revisit when a second VTT or a no-Owlbear-account table exists (near-term scope is the D&D proof of concept on Owlbear).
