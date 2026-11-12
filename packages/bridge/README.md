# @ttrpg-agents/bridge

Local bridge server for the Owlbear Rodeo extension. It serves the built
extension over HTTP and a versioned WebSocket at `/ws` (wire contract in
`@ttrpg-agents/protocol`). It is a separate process, not part of the MCP
server: the MCP server writes the encounter to SQLite, and the bridge polls
the change log in that file and pushes each new event to the extension.

## Run

```sh
npm run bridge:start     # build, then run the bridge detached from the terminal
npm run bridge:status    # what is running, from which checkout and commit
npm run bridge:restart   # stop, then start from this checkout
npm run bridge:stop
npm run bridge           # foreground instead: runs packages/bridge/dist/cli.js (build first)
```

`bridge:start` runs `npm run build` in its checkout (the bridge serves the
extension built into `packages/owlbear/dist`), starts the bridge in its own
session and returns once it listens. It refuses when a bridge is already
running (use `bridge:restart`). `bridge:stop` sends SIGTERM and waits up to
10 s, and succeeds when nothing is running. A foreground bridge on a taken port
prints one line naming the port and exits 1.

Every bridge, foreground or not, writes a state file once it listens (pid,
port, checkout, commit, start time; mode 0600 in a 0700 directory) and removes
it when it stops. The commands read it, and check with `ps` that the pid is
still that bridge before signalling it, so a stale file never leads to
signalling another process. The detached bridge's stdout and stderr go to
`bridge.log` beside the state file, emptied on each start and mode 0600; the
commands print its path.

`bridge:status` reports the profile, then the running bridge's pid, port, checkout, commit, start
time and log, with a warning when its checkout or commit is not this
checkout's. It asks the bridge for `scene-status` with the agent token to say
whether a GM tab is connected (or unknown, with the reason). With no running
bridge it says whether the port still accepts connections, held by another
process. It changes nothing and exits 0.

The bridge prints an `install in Owlbear` URL (`.../manifest.json`).
In Owlbear Rodeo, Profile > Add Custom Extension, enter that URL. Then switch
the extension on for each room that should use it: on the profile page, click
the pencil on the room's card, open Extensions and switch it on. Adding it to
the account is not enough; it does not load in a room until then. An extension
installed with an older `?token=` URL keeps working: the bridge ignores the
query.

Settings (port, served folder, agent token file, state file and database):
see [`docs/settings.md`](../../docs/settings.md).

## Test a branch

Every process started in a worktree uses the dev profile: its own database, agent token and state file, and port 5299 (see Profiles in [`docs/settings.md`](../../docs/settings.md)). The real bridge and database are untouched.

1. In the branch's worktree (after `npm ci`), run `npm run bridge:start` (`bridge:restart` after a change). It starts a dev bridge beside the real one; `npm run bridge:status` shows `profile: dev` and this checkout. One dev bridge runs at a time: stop the other worktree's first.
2. Once, add the dev extension in Owlbear from the dev bridge's install URL, `http://localhost:5299/manifest.json`, and switch it on in the test room only. Keep only one of the two extensions on in a room: both act on the same tokens.
3. Start the Claude Code session in the worktree, so its MCP server opens the same dev database. Reconnect it (`/mcp`) after a rebuild.

To drive the real table from a branch, set `TTRPG_AGENTS_PROFILE=default` for both the bridge command and the Claude Code session, for example `TTRPG_AGENTS_PROFILE=default npm run bridge:restart`. The branch's migrations then run on the real database.

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
  `roomId`, the id of the Owlbear room the tab is in (absent from an older
  tab), and `artWaits`, the monster types whose token art waits on the GM
  (monster key, name and step: `pick` while a fresh image picker is open or
  still to open, `reupload` while its stored art is listed for re-upload in
  the panel); an answer without it reads as none.
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

`POST /token-images` (body the raw image bytes) stores the image the GM picked,
sent by the extension after the pick. The request's `Origin` must be the
bridge's own, `http://localhost:<port>` or `http://127.0.0.1:<port>`, as it is
for the extension's page; it is checked before the body is read, and
`Authorization` is not read. The body is at most 1 MiB; its Content-Type is
ignored, nothing in it is read as a URL, and the bridge makes no outbound
request. The server's optional `storeTokenImage` option validates and stores it
(`cli.ts` wires the engine's `storeTokenImage` over
`SqliteTokenImageRepository`).

The answer is `{ ok: true, image: { sha256, mime, width, height } }` (200), or
`{ ok: false, error: { code, message } }`: 403 `unauthorized`, 413
`too_large`, 422 `svg`, `unsupported_type`, `unreadable` or
`dimensions_too_large`, 500 `store_failed`. A wrong Host gets the plain 403 of
every route. Without the option the route does not exist (405). See "Token and
auth" in [`docs/architecture.md`](../../docs/architecture.md).

`GET /token-images/<sha256>` (no credentials: the Host check only, and no CORS
headers, so a page on another origin cannot read the bytes) answers the stored
bytes of one image, for the extension to upload to Owlbear again. The rest of
the path must be exactly 64 lowercase hex characters, with no query string.
The answer carries the stored mime as Content-Type and
`X-Content-Type-Options: nosniff`; refusals are
`{ ok: false, error: { code, message } }`: 404 `not_found` (a malformed hash
or one the bridge does not hold). The bytes are read through
the engine's `TokenImageRepository` port (`cli.ts` wires
`SqliteTokenImageRepository`).
