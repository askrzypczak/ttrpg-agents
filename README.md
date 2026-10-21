# ttrpg-agents

DM-assist tooling for D&D and other TTRPGs: an MCP server that runs an encounter at the table, and an [Owlbear Rodeo](https://www.owlbear.rodeo) extension that shows it on the map.

## What this repo is

This is a test pet project for [claude-workflow](https://github.com/askrzypczak/claude-workflow), a ticket-driven Claude Code workflow; see that repo for how the workflow works. The product is real and I use it at my own table, but the point is to exercise the workflow on a codebase with real constraints: a monorepo, a browser extension, a WebSocket protocol, and a security boundary.

**Most of the code here was written by AI agents** working GitHub issues through that workflow. [`CLAUDE.md`](CLAUDE.md) holds this repo's conventions and guardrails. The closed [issues](https://github.com/askrzypczak/ttrpg-agents/issues?q=is%3Aissue+is%3Aclosed) and [pull requests](https://github.com/askrzypczak/ttrpg-agents/pulls?q=is%3Apr+is%3Aclosed) are the worked examples.

## Status and contributions

An experiment, not a supported product. Expect rough edges and breaking changes.

**I am the only contributor.** Issues are how I direct agents, so they are not an open tracker, and I will not review or merge outside pull requests. Feel free to read, fork and borrow ideas. The code is licensed under the [MIT License](LICENSE); the SRD data is under its own license (see [Attribution](#attribution)).

## What's in it

| Package                                                               | What it is                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`packages/engine`](packages/engine/README.md)                        | Domain engine: dice, monster schema and search, and encounter events.                                |
| [`packages/srd`](packages/srd/README.md)                              | SRD 5.2 monster data, loader and import script.                                                      |
| [`packages/store-sqlite`](packages/store-sqlite/README.md)            | SQLite encounter store (database path, migrations).                                                  |
| [`packages/mcp`](packages/mcp/README.md)                              | MCP server (stdio) with the encounter tools.                                                         |
| [`packages/bridge`](packages/bridge/README.md)                        | Local bridge server (separate process) that serves the extension and pushes encounter snapshots.     |
| [`packages/owlbear`](packages/owlbear/README.md)                      | Owlbear Rodeo extension (Vite) that shows the encounter, tested browser-free through an SDK adapter. |
| [`.claude/skills/dm-encounter`](.claude/skills/dm-encounter/SKILL.md) | Skill that turns "goblin 2 takes 7" into the fewest correct tool calls.                              |

## Quick start

Needs Node 24 (see `.node-version`).

```sh
npm ci
npm run check   # build, typecheck, lint, format check, tests
```

### Owlbear Rodeo extension (bridge)

The `owlbear` package is an Owlbear Rodeo extension served from a local bridge server that also speaks a versioned WebSocket protocol (`@ttrpg-agents/protocol`).

1. `npm run build` (builds the extension into `packages/owlbear/dist`).
2. `npm run bridge` (serves the extension and `ws://localhost:5199/ws`; override with `BRIDGE_PORT`).
3. In Owlbear Rodeo, Profile > Add Custom Extension, and enter the `install in Owlbear` URL the bridge prints: `http://localhost:5199/manifest.json?token=<token>`.
4. Chrome may ask for local network access for `owlbear.rodeo`; allow it, or the panel stays on "Connecting" and shows a hint after a few seconds.

The token lives in a file; see [`packages/bridge/README.md`](packages/bridge/README.md) for its path and `BRIDGE_TOKEN_FILE`. To rotate it, delete the token file, restart the bridge, and reinstall the extension.

Warning: `BRIDGE_STATIC_DIR` overrides the served folder, and the bridge serves whatever it points at, readable by owlbear.rodeo pages; only point it at the built extension.

The panel is GM-only and shows connection status; it reconnects with backoff if the bridge restarts.

The bridge polls the SQLite file every 250 ms and pushes a fresh snapshot when the MCP server changes it, so tokens appear without reloading the panel. For the processes, ports and data flow, see [`docs/architecture.md`](docs/architecture.md).

## Attribution

Monster data is from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode); see [`ATTRIBUTION.md`](packages/srd/data/srd-5.2/ATTRIBUTION.md). This project is not affiliated with or endorsed by Wizards of the Coast or Owlbear Rodeo.
