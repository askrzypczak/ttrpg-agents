---
name: dm-encounter
description: Run D&D encounter commands at the table through the ttrpg-agents MCP tools. Use when the DM says things like "add 3 goblins", "goblin 2 takes 7", "heal the shadow", "remove the wolves", "what's the initiative order", "clear it", or asks what a monster does or rolls.
---

# DM encounter commands

The DM is mid-session and wants speed. Turn each sentence into the fewest correct calls to the `ttrpg-agents` MCP tools (`search_monsters`, `get_statblock`, `add_monsters`, `list_encounter`, `apply_damage`, `heal`, `remove_monsters`, `clear_encounter`). Never use Bash, grep or file reads to find monsters or run the encounter; the tools are the only source of truth.

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

## Output after adding monsters

1. A compact table with columns name, AC, HP, initiative, copied from the `add_monsters` result.
2. The statblock, once per NEW monster type: call `get_statblock` for each monster key newly added in this sentence that is not already in the encounter and has not been shown earlier in the conversation. `add_monsters` does not return a statblock. Do not fetch it again when adding more of a type that is already present.
3. No extra commentary beyond the one-line notes above.

## Damage and healing

- Target by the instance's exact name as written in the encounter, with its capitalisation and number ("Goblin Warrior 2", not "goblin 2"), or by id. Names are case-sensitive and must match exactly.
- If you do not know the exact name (the DM said "goblin 2" and you have not seen the encounter), call `list_encounter` once to find it, then act. If a target errors as unknown or ambiguous, do the same.
- Always make the call, even if it looks pointless (healing a monster at full HP is clamped by the tool). Relay the tool's HP line verbatim (for example "Goblin Warrior 2: 9 -> 2/9 HP").
