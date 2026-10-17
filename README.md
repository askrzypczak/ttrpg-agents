# ttrpg-agents

Agentic tooling for D&D and other TTRPGs: DM-assist tools for use at the table, plus experiments.

Status: early setup. TypeScript/Node scaffold in place (run `npm ci && npm run check`).

## Owlbear Rodeo extension (bridge)

The `owlbear` package is an Owlbear Rodeo extension served from a local bridge server that also speaks a versioned WebSocket protocol (`@ttrpg-agents/core/bridge`).

1. `npm run build` (builds the extension into `packages/owlbear/dist`).
2. `npm run bridge -w @ttrpg-agents/mcp` (serves the extension and `ws://localhost:5199/ws`; override with `BRIDGE_PORT`).
3. In Owlbear Rodeo, Profile > Add Custom Extension, and enter `http://localhost:5199/manifest.json`.
4. Chrome may ask for local network access for `owlbear.rodeo`; allow it, or the panel stays on "Connecting" and shows a hint after a few seconds.

The panel is GM-only and shows connection status; it reconnects with backoff if the bridge restarts.
