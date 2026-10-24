# Architecture

## Hexagon (packages and ports)

The packages and the ports between them. For the dependency rules, see the Architecture section of [`CLAUDE.md`](../CLAUDE.md).

```mermaid
flowchart LR
  claude["Claude Code"] --> mcp
  subgraph driving["Driving adapters"]
    mcp["mcp: tools, formatting"]
    bsrv["bridge server: serves extension, pushes snapshots, relays queries"]
  end
  subgraph core["Engine (no I/O)"]
    uc["use cases: addMonsters, getTableStatus, ..."]
    ports["ports: EncounterRepository, MonsterIndex, TablePort"]
  end
  subgraph driven["Driven adapters"]
    store["store-sqlite"]
    srd["srd"]
    bclient["bridge client"]
  end
  mcp --> uc
  bsrv -->|"reads EncounterRepository, reads and writes TokenArtRepository"| ports
  uc --> ports
  ports -.implemented by.-> store
  ports -.implemented by.-> srd
  ports -.implemented by.-> bclient
  store --> db[("SQLite")]
  bclient -->|"HTTP + agent token (queries only)"| bsrv
  bsrv <-->|"WebSocket + token"| ext["Owlbear extension (protocol)"]
```

The bridge is both sides: the server reads the encounter through the `EncounterRepository` port and the token art through `TokenArtRepository` to push snapshots, and stores the art the extension sends, and the client is the driven end of `TablePort`. The mcp-to-bridge arrow in the runtime diagram below is made by the bridge client adapter that `mcp/src/stdio.ts` wires in. The channel is read-only by rule: it carries queries only, and the agent changes the game through the engine's model (see the rule in [`CLAUDE.md`](../CLAUDE.md)).

## Runtime (processes)

Which processes run, how they talk, and what reaches the table.

```mermaid
flowchart LR
  claude["Claude Code"] -->|"stdio"| mcp["MCP server"]
  mcp -->|"writes"| db[("SQLite file")]
  mcp -->|"TablePort via the bridge client: POST /agent/query"| bridge
  bridge["Bridge"] -->|"polls"| db
  ext["Owlbear extension"] <-->|"WebSocket + token"| bridge
  ext --> scene["Owlbear scene"]
```

## Processes

- **MCP server**: stdio, started by Claude Code from `.mcp.json` through the launcher `packages/mcp/bin/stdio.mjs`. It also calls the running bridge over loopback HTTP to ask the table something (see "Queries to the table").
- **Bridge**: `npm run bridge`, a separate process. HTTP plus WebSocket `/ws` on 127.0.0.1, default port 5199 (`BRIDGE_PORT`). It also serves the built extension (`packages/owlbear/dist`).
- **Extension**: runs in the GM's Owlbear tab and is the bridge's client.

## Shared database

Both processes use one SQLite file in WAL mode: `TTRPG_AGENTS_DB`, else `$XDG_DATA_HOME/ttrpg-agents/encounters.db`, else `~/.local/share/ttrpg-agents/encounters.db`. The MCP server writes. The bridge reads, removes one instance when the extension reports (`token-deleted`) that the GM deleted its token, applies HP, max HP and armor class edited on the table (`instance-edit`), and stores the image the GM picked for a monster type (`token-art-set`, table `token_art`).

## Token and auth

- The token file is `BRIDGE_TOKEN_FILE` (default `~/.config/ttrpg-agents/bridge-token`, mode 0600, created on first run).
- A `manifest.json` request with the right `?token=` gets the token put into the popover URL fragment. The extension reads it from `location.hash` and sends it in `hello`. The bridge compares it in constant time; a bad or missing token closes the socket.
- The Host header must be a loopback name with the actual port (DNS-rebinding defence), and the WebSocket upgrade must come from the bridge's own loopback origin on `/ws`.
- The `role` in `hello` only drives the extension UI and never authorizes.
- A second, separate agent token authorises `POST /agent/query`: file `BRIDGE_AGENT_TOKEN_FILE` (default `~/.config/ttrpg-agents/agent-token`, mode 0600, created on first run). The bridge never serves it, it is not in the manifest URL, and it authorises nothing else. The extension token is rejected on that route.

## Queries to the table

Apart from the extension's write-backs (`token-deleted`, `instance-edit`, `token-art-set`), the bridge only pushes. To let the agent ask the table something (first use: `table_status`), the MCP tool calls the engine's `getTableStatus`, which asks the `TablePort`; the bridge client (`@ttrpg-agents/bridge/client`, wired in by `mcp/src/stdio.ts`) implements the port and calls `POST /agent/query` on the bridge with `Authorization: Bearer <agent token>` and a JSON query (`{"name":"scene-status"}`). The channel is read-only by rule: a query never changes the table. The route has no CORS headers, keeps the Host check, and caps the body at 1 MiB.

1. The bridge sends the query as a `query` message with a fresh id to the one active extension client.
2. The extension answers with a `query-result` carrying the same id (or a non-fatal `error` with that id if the handler threw). A reply with another or no id does not complete the call; the bridge answers it with a non-fatal `error`.
3. The bridge returns the result as the HTTP body: `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.

Errors: 401 `unauthorized`, 400 `bad-request`, 503 `not-connected` (no GM tab), 504 `timeout` (no reply within 5 s), 502 `query-failed`. The bridge client adds `bridge-unreachable` when the bridge is not running or the agent token file is missing; the adapter (`createBridgeTable`) turns any `{ ok: false }` into a `TableUnavailableError`. Only one GM tab is connected at a time, so there is one recipient.

`scene-status` returns whether the scene is ready, how many of our tokens are on it, and how many instances the extension has applied. `getTableStatus` (engine) compares those with the encounter in the database to give the in-sync verdict; `table_status` only formats it.

## What reaches the table

The bridge polls `PRAGMA data_version` every 250 ms. When another process committed, it broadcasts an `encounter-snapshot` (the full instance list, HP included) to authenticated clients. It also sends one after each `hello-ack`.

The extension (GM role only) reconciles the scene against the latest encounter. It keeps the instances from the last snapshot, folded with the `encounter-event` messages, and fixes the difference with the scene on every snapshot, event, scene-ready change and retry after a failed apply (backoff). Nothing touches the scene until it is ready.

- **Tokens.** Our tokens carry the metadata key `com.ttrpg-agents/instance`; anything else on the scene is never touched. By default each instance is a hidden IMAGE token drawn with the art the GM picked from their Owlbear asset library for its monster type (asked once per type, when a token is first created for it, then remembered in the database as a VTT-neutral reference `{ url, mime, width, height }`; the extension derives an Owlbear grid with the image centred when it creates the token, its longer side spanning the instance's footprint in cells), or a hidden circle SHAPE token when there is no art (no usable pick: cancel, picker error or invalid image). The engine sets each instance's footprint from its monster's size category (small and medium 1 cell, large 2, huge 3, gargantuan 4; tiny and unknown sizes 1), and the store keeps it per instance (rows from before it existed read as 1). A new hidden circle is footprint cells wide and high, and tokens created in one batch sit side by side, each in a slot as wide as its footprint. Tokens that already exist are never resized or re-skinned. Per-feature values are set by projectors (`owned` or `create-only`) and written one metadata key at a time, so other extensions' keys survive.
- **The table wins.** Each token records the value last written for every `owned` key (metadata key `com.ttrpg-agents/synced`). A value is pushed only when the encounter changed since then. A table edit stands until the encounter's value changes again, and then the encounter overwrites it. An edit of HP, max HP or armor class is also written back (`instance-edit`) once it has stayed unchanged for about 500 ms (edits to one instance coalesce, and a pending or sent value stays shown until the store answers; one still settling is lost if the tab closes); until the store answers, the baseline holds the edited table value, so an accepted edit plans nothing and a clamped or refused one is pushed back.
- **Deleted tokens stay deleted.** The scene metadata key `com.ttrpg-agents/placed` lists the instances already placed on the scene, so a token the GM deleted is not recreated. A scene with no record is populated.
- **Token deletion is written back.** A deleted token (a wanted instance in `placed` with no token) is reported to the bridge, which removes the instance from the store and replies with a fresh snapshot, so the `placed` record is pruned.
