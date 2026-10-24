# @ttrpg-agents/bridge

Local bridge server for the Owlbear Rodeo extension. It serves the built
extension over HTTP and a versioned WebSocket at `/ws` (wire contract in
`@ttrpg-agents/protocol`). It is a separate process, not part of the MCP
server: the MCP server writes the encounter to SQLite, and the bridge polls
that file and pushes a fresh snapshot to the extension when it changes.

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
from `@ttrpg-agents/protocol`, e.g. `{"name":"scene-status"}`) relays the query
to the connected Owlbear tab and returns its `query-result`. Errors: 401, 400,
503 (no tab), 504 (no reply in 5 s), 502. See "Queries to the table" in
[`docs/architecture.md`](../../docs/architecture.md).

`@ttrpg-agents/bridge/client` (`createBridgeClient`) is the Node-only client the
MCP server's `stdio.ts` wires in; `createBridgeTable` implements the engine's
`TablePort` with it; it reads the agent token file on every call.

The bridge polls SQLite's `data_version` every 250 ms and pushes a snapshot
when another process commits, so tokens appear without reloading the panel.

An authenticated client can send `token-deleted` (`{ instanceId }`, sent by the
extension when the GM deletes one of our tokens). The server's optional
`removeInstance` option performs the removal (`cli.ts` wires
`removeInstance(repo, id)` from `encounter-bridge.ts`) and the bridge replies
with a fresh snapshot, since its own commits do not bump `data_version`. A
refusal (`unknown-instance`) or a failed write (`remove-failed`) is a non-fatal
`error` that echoes the request id. Without the option the type is
`unexpected-type`. The client's `role` is never read.

An authenticated client can also send `token-art-set` (`{ monsterKey, art }`,
sent by the extension after the GM picks an image for a monster type). The
server's optional `setTokenArt` option stores it (`cli.ts` wires
`SqliteTokenArtRepository.setTokenArt`) and the bridge replies with a fresh
snapshot, whose `art` map (monster key -> image reference `{ url, mime, width, height }`) it sends from the
same store. A failed write is a non-fatal `token-art-failed` `error` and no
snapshot. Without the option the type is `unexpected-type`.
