# @ttrpg-agents/mcp

MCP server (stdio) exposing the encounter tools from `@ttrpg-agents/engine`.

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

| Tool                   | Purpose                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_monsters`      | Name search (top 10) with keys                                                                                                             |
| `get_statblock`        | Markdown statblock by key                                                                                                                  |
| `add_monsters`         | Add groups (`monster`, `count`, `hp`) in one call; rolls HP/init; `join` (id or exact name) adds to that monster's group and initiative    |
| `move_monsters`        | Move monsters (ids or exact names, all-or-nothing) into a saved room, keeping their state; one already in that room avoids its own cells   |
| `list_encounter`       | Encounter in initiative order with AC and HP, and the removed monsters that can be restored                                                |
| `apply_damage`         | Damage by instance id or exact name (clamped at 0)                                                                                         |
| `heal`                 | Heal by instance id or exact name (clamped at max)                                                                                         |
| `set_hp`               | Set an exact current HP by instance id or exact name (clamped to 0..max); reports before and after                                         |
| `set_max_hp`           | Set an exact max HP by instance id or exact name; HP is lowered if above it, never raised; reports before and after                        |
| `reset_max_hp`         | Reset max HP (by id or exact name, all-or-nothing) to the statblock average or a new roll; full HP stays full; reports before and after    |
| `set_armor_class`      | Set an exact armor class by instance id or exact name; reports before and after                                                            |
| `remove_monsters`      | Remove several targets, all-or-nothing                                                                                                     |
| `restore_monsters`     | Bring back removed monsters by instance id or exact name, all-or-nothing, with HP and initiative; a taken name gets a new number           |
| `rename_monster`       | Rename by instance id or exact name; unique, non-empty                                                                                     |
| `set_initiative`       | Set an exact initiative by instance id or exact name; reports before and after                                                             |
| `roll_initiative`      | Roll initiative for several monsters by id or exact name (one roll per group, or each); reports roll, modifier, before and after           |
| `split_initiative`     | Give several monsters their own initiative group each, by id or exact name; keeps each value, or rolls each with `roll`                    |
| `merge_initiative`     | Put several monsters in one initiative group by id or exact name; each takes the first named monster's initiative, no roll                 |
| `set_stats_visibility` | Show or hide several monsters' Stat Bubbles (HP and AC) to the players                                                                     |
| `clear_encounter`      | Remove every monster; replies with their names, and `restore_encounter` can bring them back                                                |
| `restore_encounter`    | Bring back every monster the last clear removed, with HP, initiative, group and stats visibility; a taken name gets a new number           |
| `table_status`         | Ask the Owlbear tab for its scene status; reports in sync or not                                                                           |
| `use_map`              | Use the map aligned on the Owlbear scene; reports its grid size                                                                            |
| `set_rooms`            | Name rooms on the map in use by display-cell ranges (confirmed, or proposed); a room named like a saved one replaces it                    |
| `list_rooms`           | The saved rooms of the map in use with their status and ranges where the map sits now                                                      |
| `remove_rooms`         | Remove saved rooms by name, all-or-nothing                                                                                                 |
| `get_map_image`        | Gridded image of the map in use as the DM sees it (an image block) and its grid size; needs the bridge                                     |
| `propose_rooms`        | Room proposals from ranges read on the map image: each range shrunk by one cell where the room is at least three cells wide; saves nothing |

`table_status`, `use_map`, `set_rooms`, `list_rooms`, `get_map_image`,
`move_monsters`, and `add_monsters` with a `room` need the bridge running (`npm run bridge`) and a GM
tab open: they ask the table through the engine's `TablePort` (wired to the bridge
client in `src/stdio.ts`), and a stopped bridge, no tab or a slow tab come back as
`isError` results. `remove_rooms` and `propose_rooms` do not ask the table.

Domain errors (unknown monster, ambiguous target, bad amount) come back as
`isError` results rather than protocol errors.
