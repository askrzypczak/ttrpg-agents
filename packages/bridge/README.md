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
from `@ttrpg-agents/protocol`, e.g. `{"name":"scene-status"}`,
`{"name":"scene-map"}`, `{"name":"scene-tokens"}` or
`{"name":"map-image","itemId":"..."}`) relays the query to the connected
Owlbear tab and returns its `query-result`. `scene-tokens` returns the
position of each item on the character and mount layers; the room placement
for `add_monsters` (#50) reads it. `map-image` returns the map item's image
as the DM sees it with the display grid and its labels, as WEBP or JPEG
base64 with its size in px; the bridge waits 30 s for it
(`mapImageTimeoutMs`). Errors: 401, 400, 503 (no tab), 504 (no reply in 5 s;
30 s for `map-image`), 502. See "Queries to the table" in
[`docs/architecture.md`](../../docs/architecture.md).

`@ttrpg-agents/bridge/client` (`createBridgeClient`) is the Node-only client the
MCP server's `stdio.ts` wires in; `createBridgeTable` implements the engine's
`TablePort` with it; it reads the agent token file on every call.

The bridge polls the change log every 250 ms (`broadcastLogEvents`) and
broadcasts each event committed since it started as an `encounter-event`
carrying its `seq`, oldest first, so tokens appear without reloading the panel.
The poll sees the bridge's own commits too. A client that connects gets an
`encounter-snapshot` carrying the `seq` it is current as of, read before the
instances; events at or before that `seq` may still arrive and the client
ignores them. A failed read is retried on the next tick. A row the bridge cannot
parse (for example one written by a newer MCP server) is skipped: `cli.ts`
reports it once on stderr with its `seq`, and every client gets a fresh snapshot
in its place.

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
