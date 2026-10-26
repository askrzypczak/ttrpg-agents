---
name: dm-encounter
description: Run D&D encounter commands at the table through the ttrpg-agents MCP tools. Use when the DM says things like "add 3 goblins", "goblin 2 takes 7", "heal the shadow", "goblin 2 is at 4 HP", "the shadow has AC 15", "remove the wolves", "bring the wolf back", "what's the initiative order", "clear it", "bring the encounter back", "use the current map", "we're on the Trollskull map", "the taproom is T5 to AB11", "what rooms are there", "remove the attic", "label the rooms", or asks what a monster does or rolls.
---

# DM encounter commands

The DM is mid-session and wants speed. Turn each sentence into the fewest correct calls to the `ttrpg-agents` MCP tools (`search_monsters`, `get_statblock`, `add_monsters`, `move_monsters`, `list_encounter`, `apply_damage`, `heal`, `set_hp`, `set_max_hp`, `set_armor_class`, `remove_monsters`, `restore_monsters`, `set_initiative`, `roll_initiative`, `set_stats_visibility`, `clear_encounter`, `restore_encounter`, `use_map`, `set_rooms`, `list_rooms`, `remove_rooms`, `get_map_image`, `propose_rooms`). Never use Bash, grep or file reads to find monsters or run the encounter; the tools are the only source of truth.

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

- A named room ("in the taproom", "into the kitchen") goes to that group's `room` in `add_monsters`, as the DM says it (the tool matches saved rooms ignoring case). Several groups can name the same or different rooms in one call.
- If a call with a room fails because the room is unknown (the error lists the known rooms), follow the live steps under Proposing rooms. On any other failure (no map in use, the map is no longer on the scene, a grid that is not square, or the bridge or the Owlbear tab cannot be reached), relay the error and stop: nothing was added. Do not retry without the room, and do not call `use_map` on your own.
- Moving monsters already in the encounter into a room ("no, the wolf goes in the kitchen" right after an add, or "the goblins retreat to the hall") is ONE `move_monsters` call with the monsters' exact names (or ids) in `targets` and the room as the DM says it. Never remove the monsters and add them again: the move keeps their HP, initiative and names. If the room is unknown, follow the same live steps as for `add_monsters` (under Proposing rooms), then make the same `move_monsters` call again; on any other failure relay the error and stop.
- After a move, relay the tool's "Moved into ..." and "No free cell left ..." lines verbatim, and the line saying the map moved if present.
- Other positions and flavour ("on the left", "circling from behind", "ambushing from the trees") are not tracked. Acknowledge them in one short line ("Positions other than rooms aren't tracked, so I've skipped 'on the left'.") and still run the rest of the request.

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

## Proposing rooms

`get_map_image` returns the map in use as the DM sees it, with column letters on its top and bottom edges and row numbers on its left and right edges, and a line with its grid size. Read cells from those labels. `propose_rooms` turns the ranges you read into proposals: it shrinks each range by one cell on every side where the room is at least three cells wide, and saves nothing. Show and save its ranges exactly as it returns them; never shrink or adjust a range yourself.

To propose a room, find its printed name on the image and read the cells of its interior: one range, or several for an L-shaped room. Read each arm of an L-shaped room as a full rectangle that runs to the room's outer walls, so the arms overlap where they meet (`T5:AB11` and `T5:V14`, not `T5:AB11` and `T12:V14`); the shrunk arms then still touch.

Prep ("label the rooms", "find the rooms on this map"):

- Call `get_map_image` once, then ONE `propose_rooms` call with every room whose name is printed on the map.
- Show its proposals as a short list, one line per room ("Taproom U6:AA10"), and ask the DM to confirm or correct them. Do not call `set_rooms` yet: nothing is stored before the DM confirms.
- When the DM confirms, make ONE `set_rooms` call with every room and exactly the ranges shown, with the DM's corrections applied as the DM gives them (a corrected range is used as given, not proposed again). Omit `status`: rooms the DM confirms are confirmed. Relay its line.
- If the map's rooms are numbered instead of named, ask the DM for the names (the adventure's key has them) and propose only the rooms the DM names: "room 3 is the kitchen" names the room printed 3.

Live (the DM names a room that is not saved):

- When `add_monsters` fails because the room is unknown, call `get_map_image`.
- If the room's name is printed on the map, or the DM named its number earlier in the session, call `propose_rooms` with just that room, named after the DM's word and capitalised ("Library" for "the library", so the retry matches), then ONE `set_rooms` call with that room, its proposed ranges and `status` "proposed", then the same `add_monsters` call again.
- After the output for the add, tell the DM in one line what was guessed: "I guessed the Library at H3:L8 from the map and saved it as proposed; drag the tokens or tell me its cells to correct it."
- If the room's name is not printed on the map, or the rooms are numbered and the DM has not named that one, relay the unknown-room error and ask where the room is. Do not guess.

If `get_map_image` fails (no map in use, the map is no longer on the scene, a grid that is not square, or the bridge or the Owlbear tab cannot be reached), relay the error and stop; do not call `use_map` on your own.

## Output after adding monsters

1. A compact table with columns name, AC, HP, initiative, copied from the `add_monsters` result.
2. When a group had a room, the tool's "Placed in ..." and "No free cell left ..." lines verbatim, and the line saying the map moved if present; after a room was proposed live, also the one-line guess (see Proposing rooms).
3. The statblock, once per NEW monster type: call `get_statblock` for each monster key newly added in this sentence that is not already in the encounter and has not been shown earlier in the conversation. `add_monsters` does not return a statblock. Do not fetch it again when adding more of a type that is already present.
4. No extra commentary beyond the one-line notes above.

## Damage and healing

- Target by the instance's exact name as written in the encounter, with its capitalisation and number ("Goblin Warrior 2", not "goblin 2"), or by id. Names are case-sensitive and must match exactly.
- If you do not know the exact name (the DM said "goblin 2" and you have not seen the encounter), call `list_encounter` once to find it, then act. If a target errors as unknown or ambiguous, do the same.
- Always make the call, even if it looks pointless (healing a monster at full HP is clamped by the tool). Relay the tool's HP line verbatim (for example "Goblin Warrior 2: 9 -> 2/9 HP").

## Setting HP, max HP and armor class

- "Goblin Warrior 2 is at 4 HP" is one `set_hp` call with `hp` 4. "The shadow has AC 15 now" is one `set_armor_class` call with `armorClass` 15. "The wolf has 15 max HP" is one `set_max_hp` call with `maxHp` 15. Target each monster as under Damage and healing.
- Use only the number the DM gives; never turn it into a damage or healing amount. If they name a monster without a number, ask for it.
- When the DM gives both max HP and HP ("the wolf has 15 max HP and is at 12"), call `set_max_hp` first and `set_hp` after it, never in parallel: HP is clamped to the max HP at the time of the call.
- `set_max_hp` lowers HP above the new max but never raises it. If the DM says the monster is at full HP, call `set_hp` after `set_max_hp`, using the max HP from its reply.
- Do not call `list_encounter` after the calls. Relay each tool's line verbatim (for example "Goblin Warrior 2: HP 9 -> 4/9", "Wolf 1: max HP 11 -> 15, HP 11 -> 11/15", "Shadow 1: AC 12 -> 15").

## Changing initiative

- "The goblins act on 14" is one `set_initiative` call per goblin, each with `initiative` 14. The tool takes one target, so run the calls in parallel. Target each goblin as under Damage and healing.
- Use only the number the DM gives. If they name a monster without a number and do not ask to roll, ask for it.
- Do not call `list_encounter` after the calls. Relay the tool's line verbatim (for example "Goblin Warrior 1: initiative 12 -> 14").
- "Re-roll the goblins' initiative" and "roll initiative for the wolves" are ONE `roll_initiative` call with every matching monster in `targets`, targeted as under Damage and healing. Omit `mode`, so monsters of one group share one roll; pass `mode: "each"` only when the DM asks for separate rolls ("roll each goblin separately"). Every named monster is rolled, even one that already has initiative.
- Do not call `list_encounter` after the call. Relay the tool's lines verbatim (for example "Goblin Warrior 1: initiative 12 -> 9 (d20 7, modifier +2)").

## Showing stats to players

Monsters' HP and AC (the Stat Bubbles on their tokens) are GM-only by default. The DM can show them to the players and hide them again.

- "Let the players see the goblins' stats" / "reveal the shadow's HP" is one `set_stats_visibility` call with `visible: true` and every matching monster in `targets` (names or ids; a group is its members, so list "Goblin Warrior 1", "Goblin Warrior 2", ...). "Hide the goblins from the players" is the same call with `visible: false`.
- To add monsters the players can see stats for ("add 2 wolves the players can see"), set `statsVisible: true` on that group in the `add_monsters` call; one call, no second step.
- If you do not know the exact names, call `list_encounter` once to find them. Do not call it after the change. Relay the tool's line verbatim.
- This only controls the stat bubbles. The token itself stays hidden from players until the DM shows it in Owlbear.

## Bringing monsters back

Removed monsters stay restorable until the next `clear_encounter` that clears monsters, and a clear's monsters stay restorable until the next clear that clears monsters.

- "Oops, the wolf's not dead" or "bring back goblin warrior 2" is ONE `restore_monsters` call with every monster the DM names in `targets`, by the exact name it had when removed (or its id). It comes back with its HP, initiative and group, and its token comes back on the table.
- "Bring them back", "undo the clear" or "oops, I didn't mean to clear" after a `clear_encounter` is ONE `restore_encounter` call (no arguments): every cleared monster comes back with its HP, initiative, group and stats visibility, and its tokens come back on the table. No `restore_monsters` or `add_monsters` for it. Relay the tool's line verbatim.
- To bring back only some monsters of a cleared encounter, use `restore_monsters` with their names (the clear's reply and `list_encounter`'s "Cleared encounter" line name them; for a big set, `restore_encounter` brings everything back).
- If you do not know the exact name, call `list_encounter` once: its lines name the removed monsters that can be restored. If a target errors, do the same.
- Relay the tool's line verbatim (for example "Restored 1: Wolf 2 (5/11 HP)"). A monster whose name was taken meanwhile comes back under a new number, and the line says so ("was Wolf 2").
- Monsters removed before the last `clear_encounter` that cleared monsters cannot be restored.
