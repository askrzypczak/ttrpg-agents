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
In Owlbear Rodeo, Profile > Add Custom Extension, enter that URL.

Environment:

- `BRIDGE_PORT`: port to listen on (default `5199`).
- `BRIDGE_STATIC_DIR`: folder to serve (default `packages/owlbear/dist`). The
  bridge serves whatever it points at, readable by owlbear.rodeo pages, so only
  point it at the built extension.
- `BRIDGE_TOKEN_FILE`: persistent token, created with mode 0600 on first run
  (default `~/.config/ttrpg-agents/bridge-token`).
- `BRIDGE_AGENT_TOKEN_FILE`: agent token for `POST /agent/command`, created
  with mode 0600 on first run (default `~/.config/ttrpg-agents/agent-token`).
  It is never served and is separate from the extension token.
- `TTRPG_AGENTS_DB`: the encounter database to watch, the same file the MCP
  server writes (see `packages/mcp/README.md` for the default location).

## Commands

`POST /agent/command` (`Authorization: Bearer <agent token>`, body a command
from `@ttrpg-agents/protocol`, e.g. `{"name":"scene-status"}`) relays the command
to the connected Owlbear tab and returns its `command-result`. Errors: 401, 400,
503 (no tab), 504 (no reply in 5 s), 502. See "Commands to the table" in
[`docs/architecture.md`](../../docs/architecture.md).

`@ttrpg-agents/bridge/client` (`createBridgeClient`) is the Node-only client the
MCP server uses; it reads the agent token file on every call.

The bridge polls SQLite's `data_version` every 250 ms and pushes a snapshot
when another process commits, so tokens appear without reloading the panel.
