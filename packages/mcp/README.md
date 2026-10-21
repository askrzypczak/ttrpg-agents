# @ttrpg-agents/mcp

MCP server (stdio) exposing the encounter tools from `@ttrpg-agents/core`.

## Run

```sh
npm run build          # the server runs from packages/mcp/dist
node packages/mcp/dist/stdio.js
```

The repo-root `.mcp.json` registers it as `ttrpg-agents` for Claude Code
(approve the project server on first use).

The encounter is stored in SQLite (implemented by [`@ttrpg-agents/store-sqlite`](../store-sqlite/README.md)) at `$TTRPG_AGENTS_DB`, else
`$XDG_DATA_HOME/ttrpg-agents/encounters.db`, else
`~/.local/share/ttrpg-agents/encounters.db`.

The project skill `.claude/skills/dm-encounter` tells Claude how to turn DM
table commands into these tool calls (see its `EVALS.md` for the prompt evals).

## Tools

| Tool              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `search_monsters` | Name search (top 10) with keys                                   |
| `get_statblock`   | Markdown statblock by key                                        |
| `add_monsters`    | Add groups (`monster`, `count`, `hp`) in one call; rolls HP/init |
| `list_encounter`  | Encounter in initiative order with HP                            |
| `apply_damage`    | Damage by instance id or exact name (clamped at 0)               |
| `heal`            | Heal by instance id or exact name (clamped at max)               |
| `remove_monsters` | Remove several targets, all-or-nothing                           |
| `clear_encounter` | Remove every monster                                             |

Domain errors (unknown monster, ambiguous target, bad amount) come back as
`isError` results rather than protocol errors.
