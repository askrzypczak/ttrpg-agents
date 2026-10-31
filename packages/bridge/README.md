# @ttrpg-agents/bridge

Local bridge server for the Owlbear Rodeo extension. It serves the built
extension over HTTP and a versioned WebSocket at `/ws` (wire contract in
`@ttrpg-agents/protocol`). It is a separate process, not part of the MCP
server: the MCP server writes the encounter to SQLite, and the bridge polls
the change log in that file and pushes each new event to the extension.

## Run

```sh
npm run build          # the bridge serves the extension built into packages/owlbear/dist
npm run bridge         # from the repo root; runs packages/bridge/dist/cli.js
```

The bridge prints an `install in Owlbear` URL (`.../manifest.json?token=...`).
In Owlbear Rodeo, Profile > Add Custom Extension, enter that URL. Then switch
the extension on for each room that should use it: on the profile page, click
the pencil on the room's card, open Extensions and switch it on. Adding it to
the account is not enough; it does not load in a room until then.

Environment:

- `BRIDGE_PORT`: port to listen on (default `5199`).
- `BRIDGE_STATIC_DIR`: folder to serve (default `packages/owlbear/dist`). The
  bridge serves whatever it points at, readable by owlbear.rodeo pages, so only
  point it at the built extension.
- `BRIDGE_TOKEN_FILE`: persistent token, created with mode 0600 on first run
  (default `~/.config/ttrpg-agents/bridge-token`).
- `BRIDGE_AGENT_TOKEN_FILE`: agent token for `POST /agent/query`, created
  with mode 0600 on first run (default `~/.config/ttrpg-agents/agent-token`).
  It is never served and is separate from the extension token.
- `TTRPG_AGENTS_DB`: the encounter database to watch, the same file the MCP
  server writes (see `packages/mcp/README.md` for the default location).

## Queries

`POST /agent/query` (`Authorization: Bearer <agent token>`, body a query
from `@ttrpg-agents/protocol`, at most 1 MiB) relays the query to the
connected Owlbear tab and returns its answer. The route keeps the Host check
and has no CORS headers. The channel carries queries only; "Queries to the
table" in [`docs/architecture.md`](../../docs/architecture.md) has the path
from the engine and which use case reads each query.

1. The bridge sends the query as a `query` message with a fresh id to the one
   active extension client.
2. The extension answers with a `query-result` carrying the same id, or a
   non-fatal `error` with that id if the handler threw. A reply with another
   or no id does not complete the call; the bridge answers it with a
   non-fatal `error`.
3. The bridge returns `{ ok: true, result }` or
   `{ ok: false, error: { code, message } }`.

Errors: 401 `unauthorized`, 400 `bad-request`, 503 `not-connected` (no GM
tab), 504 `timeout` (no reply within 5 s; 30 s for `map-image`,
`mapImageTimeoutMs`), 502 `query-failed` (the extension's handler threw, for
example on a scene that is not ready). The bridge client adds
`bridge-unreachable` when the bridge is not running or the agent token file is
missing, and `createBridgeTable` turns any `{ ok: false }` into the engine's
`TableUnavailableError`.

The queries:

- `scene-status` (`{"name":"scene-status"}`): whether the scene is ready, how
  many of our tokens are on it, how many instances the extension has applied,
  and `artWaits`, the monster types whose token art waits on the GM (monster
  key, name and step: `pick` while a fresh image picker is open or still to
  open, `reupload` while its stored art is listed for re-upload in the panel);
  an answer without it reads as none.
- `scene-map`: the scene grid (dpi and type) and, for each image on the map
  layer, its id, name, image size, image grid (dpi and offset) and transform
  (position, rotation, scale). On a scene that is not ready the extension's
  reads fail and the reply is `query-failed`.
- `scene-tokens`: the axis-aligned bounds (scene units) of every item on the
  `CHARACTER` and `MOUNT` layers, hidden ones and our own tokens included,
  whatever their metadata, read with Owlbear's `getItemBounds` one call per
  item. A scene that is not ready, or a failed bounds read, is `query-failed`.
- `map-image` (`{"name":"map-image","itemId":"..."}`): that map image as the
  DM sees it (rotation and scale applied) with the engine's display grid drawn
  over it, downscaled to a long side of at most 1600 px and encoded as WEBP
  (JPEG where the browser cannot encode WEBP) at decreasing quality until its
  base64 fits under the 1 MiB message cap (`MAX_MESSAGE_BYTES`); the reply
  carries its mime type, base64 data and pixel size. The extension draws it on
  an offscreen canvas, so nothing is written to the scene. An id that is not a
  map image on the scene, or an image that does not fit at the lowest quality,
  is `query-failed`.

`@ttrpg-agents/bridge/client` (`createBridgeClient`) is the Node-only client the
MCP server's `stdio.ts` wires in; `createBridgeTable` implements the engine's
`TablePort` with it; it reads the agent token file on every call.

The bridge polls the change log every 250 ms (`broadcastLogEvents`) and
broadcasts each event committed since it started as an `encounter-event`
carrying its `seq`, oldest first, so tokens appear without reloading the panel.
The poll sees the bridge's own commits too. A client that connects gets an
`encounter-snapshot` carrying the `seq` it is current as of, read before the
instances; events at or before that `seq` may still arrive and the client
ignores them. Its `restoreSeqs` gives, for each instance a restore put back, the
`seq` of its last restore; it is read after the instances, so it lists every
restore they reflect, and is left out when empty. A failed read is retried on
the next tick. A row the bridge cannot parse (for example one written by a newer
MCP server) is skipped: `cli.ts` reports it once on stderr with its `seq`, and
every client gets a fresh snapshot in its place.

The bridge also polls the active map and its rooms every 250 ms and sends
`map-rooms` (the active map's item id and its rooms) to every client on change
and after each `hello-ack`, after the snapshot; no active map sends an empty
list. A failed rooms read for the push after `hello-ack` is logged, and
nothing is sent.

An authenticated client can send `token-deleted` (`{ instanceId }`, sent by the
extension when the GM deletes one of our tokens). The server's optional
`removeInstance` option performs the removal (`cli.ts` wires
`removeInstance(repo, id)` from `encounter-bridge.ts`). An accepted request gets
no reply of its own: the poll's `table` event for the removal carries the
request id as its command id, and the extension takes it as the
acknowledgement. An accepted `instance-edit` is answered the same way, by its
`table` events. A refusal (`unknown-instance`) or a failed write
(`remove-failed`) is a non-fatal `error` that echoes the request id. Without
the option the type is `unexpected-type`. The client's `role` is never read.

An authenticated client can also send `token-art-set` (`{ monsterKey, art }`,
sent by the extension after the GM picks an image for a monster type). The
server's optional `setTokenArt` option stores it (`cli.ts` wires
`SqliteTokenArtRepository.setTokenArt`). An accepted request gets no reply: the
extension keeps its own pick, and the snapshot on every connect carries the
`art` map (monster key -> image reference `{ url, mime, width, height }`) from
the same store. A failed write is a non-fatal `token-art-failed` `error`.
Without the option the type is `unexpected-type`.

## Token images

`POST /token-images` (`Authorization: Bearer <extension token>`, body the raw
image bytes) stores the image the GM picked, sent by the extension after the
pick. The token is checked before the body is read, and the agent token is
refused. The body is at most 1 MiB; its Content-Type is ignored, nothing in it
is read as a URL, and the bridge makes no outbound request. The server's
optional `storeTokenImage` option validates and stores it (`cli.ts` wires the
engine's `storeTokenImage` over `SqliteTokenImageRepository`). The answer is
`{ ok: true, image: { sha256, mime, width, height } }` (200), or
`{ ok: false, error: { code, message } }`: 401 `unauthorized`, 413
`too_large`, 422 `svg`, `unsupported_type`, `unreadable` or
`dimensions_too_large`, 500 `store_failed`. A wrong Host gets the plain 403 of
every route. Without the option the route does not exist (405). See "Token and
auth" in [`docs/architecture.md`](../../docs/architecture.md).

`GET /token-images/<sha256>` (`Authorization: Bearer <extension token>`,
checked in constant time before the hash is looked up; the agent token is
refused) answers the stored bytes of one image, for the extension to upload to
Owlbear again. The rest of the path must be exactly 64 lowercase hex
characters, with no query string. The answer carries the stored mime as
Content-Type and `X-Content-Type-Options: nosniff`; refusals are
`{ ok: false, error: { code, message } }`: 401 `unauthorized`, 404 `not_found`
(a malformed hash or one the bridge does not hold). The bytes are read through
the engine's `TokenImageRepository` port (`cli.ts` wires
`SqliteTokenImageRepository`).
