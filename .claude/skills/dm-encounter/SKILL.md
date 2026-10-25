---
name: dm-encounter
description: Run D&D encounter commands at the table through the ttrpg-agents MCP tools. Use when the DM says things like "add 3 goblins", "goblin 2 takes 7", "heal the shadow", "remove the wolves", "what's the initiative order", "clear it", "use the current map", "we're on the Trollskull map", "the taproom is T5 to AB11", "what rooms are there", "remove the attic", or asks what a monster does or rolls.
---

# DM encounter commands

The DM is mid-session and wants speed. Turn each sentence into the fewest correct calls to the `ttrpg-agents` MCP tools (`search_monsters`, `get_statblock`, `add_monsters`, `list_encounter`, `apply_damage`, `heal`, `remove_monsters`, `set_initiative`, `set_stats_visibility`, `clear_encounter`, `use_map`, `set_rooms`, `list_rooms`, `remove_rooms`). Never use Bash, grep or file reads to find monsters or run the encounter; the tools are the only source of truth.

## Fewest calls

- One `add_monsters` call for the whole sentence: "3 shadows and 2 wolves" is one call with two `groups`.
- One `remove_monsters` call with several `targets`.
- Do not call `list_encounter` after a mutation. Only call it when the DM asks for the order or state, or to find an exact name (see Damage and healing).
- Do not ask for confirmation on routine commands (damage, heal, remove, clear); just do them.
- Run independent calls (for example several `search_monsters`) in parallel.

## Resolving monster names

- Call `search_monsters` for each monster name first, unless the key is already known from this session.
- If one match is clear (exact or plural-tolerant name match, or a single result), use it without asking.
- If several unrelated or differently-sized matches fit (for example "a dragon" returns many dragons, "a goblin" returns warrior, boss and minion), ask the DM which one, listing the options briefly, and add nothing until they answer.

## Never invent numbers

HP, AC, initiative, rolls, damage totals and attack bonuses come only from tool output. Do not roll dice yourself, do not guess, and do not explain how a total was derived. If the tools cannot produce a number, say so. For "what does X roll to hit", read the statblock with `get_statblock` and quote it; do not roll.

## Spatial and narrative hints

Positions and flavour ("on the left", "circling from behind", "ambushing from the trees") are not supported yet. Acknowledge them in one short line ("Positions aren't tracked yet, so I've skipped 'on the left'.") and still run the rest of the request.

## Using the map

The GM aligns the map image on the Owlbear scene first. Then "use the current map", "we're on the Trollskull map" or "I moved the map, use it again" is a `use_map` call.

- Call `use_map` without `name`. If it works, relay its line verbatim (for example "Using Trollskull Manor: 32 x 24 cells, columns A-AF left to right, rows 1-24 top to bottom.").
- If it fails because there are several maps, the error lists their names. Call `use_map` once more with the listed name, copied exactly as listed, that matches the DM's words ("the Trollskull map" is "Trollskull Manor"). If none of the names matches, relay the list and ask which map the DM means.
- On any other failure (no map on the scene, a grid that is not square, the bridge or the Owlbear tab not reachable), relay the error and do not retry.
- Calling `use_map` again after the GM moves or rescales the map is how the DM confirms the new alignment.

## Naming rooms

Rooms are named on the map in use by its display cells (columns A, B, ... left to right, rows 1, 2, ... top to bottom).

- "The taproom is T5 to AB11" is one `set_rooms` call with one room: `name` "Taproom", `ranges` ["T5:AB11"]. Several rooms in one sentence are one call with several `rooms`. An L-shaped room is one room with two ranges, such as "A1:C3" and "D1:D2". Rooms the DM names are confirmed, so omit `status`.
- "What rooms are there" is a `list_rooms` call; relay its table.
- "Remove the attic" is one `remove_rooms` call with every room the DM names in `names`.
- Relay each tool's line verbatim (for example "Saved 1 room on Trollskull Manor (confirmed): Taproom T5:AB11.").
- If a tool fails because no map is in use, relay the error and do not call `use_map` on your own: the GM confirms the alignment by asking to use the map.
- If the reply says the map moved since it was registered, relay that line too.
- On an unknown room or a bad range, relay the error and do not retry.

## Output after adding monsters

1. A compact table with columns name, AC, HP, initiative, copied from the `add_monsters` result.
2. The statblock, once per NEW monster type: call `get_statblock` for each monster key newly added in this sentence that is not already in the encounter and has not been shown earlier in the conversation. `add_monsters` does not return a statblock. Do not fetch it again when adding more of a type that is already present.
3. No extra commentary beyond the one-line notes above.

## Damage and healing

- Target by the instance's exact name as written in the encounter, with its capitalisation and number ("Goblin Warrior 2", not "goblin 2"), or by id. Names are case-sensitive and must match exactly.
- If you do not know the exact name (the DM said "goblin 2" and you have not seen the encounter), call `list_encounter` once to find it, then act. If a target errors as unknown or ambiguous, do the same.
- Always make the call, even if it looks pointless (healing a monster at full HP is clamped by the tool). Relay the tool's HP line verbatim (for example "Goblin Warrior 2: 9 -> 2/9 HP").

## Changing initiative

- "The goblins act on 14" is one `set_initiative` call per goblin, each with `initiative` 14. The tool takes one target, so run the calls in parallel. Target each goblin as under Damage and healing.
- Use only the number the DM gives. If they name a monster without a number, ask for it.
- Do not call `list_encounter` after the calls. Relay the tool's line verbatim (for example "Goblin Warrior 1: initiative 12 -> 14").

## Showing stats to players

Monsters' HP and AC (the Stat Bubbles on their tokens) are GM-only by default. The DM can show them to the players and hide them again.

- "Let the players see the goblins' stats" / "reveal the shadow's HP" is one `set_stats_visibility` call with `visible: true` and every matching monster in `targets` (names or ids; a group is its members, so list "Goblin Warrior 1", "Goblin Warrior 2", ...). "Hide the goblins from the players" is the same call with `visible: false`.
- To add monsters the players can see stats for ("add 2 wolves the players can see"), set `statsVisible: true` on that group in the `add_monsters` call; one call, no second step.
- If you do not know the exact names, call `list_encounter` once to find them. Do not call it after the change. Relay the tool's line verbatim.
- This only controls the stat bubbles. The token itself stays hidden from players until the DM shows it in Owlbear.
