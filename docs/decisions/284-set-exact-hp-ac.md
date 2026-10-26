# feature: set a monster's current HP, max HP or armor class to an exact value from the MCP

Issue: [#284](https://github.com/askrzypczak/ttrpg-agents/issues/284).

## 284.1 Exact HP, max HP and armor class are three single-target MCP tools: `set_hp`, `set_max_hp` and `set_armor_class`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: The ticket left the tool shape to the plan ("tools, or one tool"). `set_initiative` already sets one exact value on one target, and the repository has one setter per value (`setHp`, `setMaxHp`, `setArmorClass`).
- Options:
  - Chosen: three tools, each built like `set_initiative` (one target, one value, one setter call, one before -> after line).
  - One combined tool with optional `hp`, `maxHp` and `armorClass`: one call and one command id for "15 max HP and at 15", but a multi-field input shape no other tool has, a reply of several lines, and an ordering rule (max HP before HP) inside the adapter.
- Where: `setHpTool`, `setMaxHpTool`, `setArmorClassTool` and `tools` in `packages/mcp/src/tools.ts`; `packages/mcp/README.md` (Tools); `.claude/skills/dm-encounter/SKILL.md` (Setting HP, max HP and armor class).
- Revisit if: the undo of #283 needs a sentence like "15 max HP and at 15" undone as one step.
- Status: active

## 284.2 The tools accept any integer and leave range limits to the engine; the reply shows the clamped value

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: The engine already clamps: current HP to 0..max HP (`clampHp`), max HP to at least 1 (`resizeMaxHp`) and armor class to at least 0 (`clampArmorClass`). `set_initiative` also takes any integer.
- Options:
  - Chosen: the input schemas require an integer only (`z.number().int()`); the engine clamps and the reply's after value is the engine's.
  - Reject out-of-range values in the schema (`min(0)`, `min(1)`): a second copy of each range in the adapter that can drift from the engine's.
- Where: the `inputSchema` of `set_hp`, `set_max_hp` and `set_armor_class` in `packages/mcp/src/tools.ts`.
- Status: active

## 284.3 For "X has N max HP" the skill relays the `set_max_hp` line as is; "at full" is a `set_hp` call with the max HP from that reply

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: `setMaxHp` lowers current HP above the new max but never raises it (`resizeMaxHp`), so a wolf at 11/11 given 15 max HP ends at 11/15. #279 proposes "at full stays at full", but only in its own use case. The spec audit asked what the `dm-encounter` rule should say.
- Options:
  - Chosen: relay the line; when the DM says the monster is at full HP, call `set_hp` after `set_max_hp` with the max HP from its reply. Every number still comes from a tool reply.
  - Relay only and let the DM correct ("it's at 15"): one more turn for the common "and it's at full".
  - Carry full HP automatically in the skill: a game rule in an adapter; it belongs in the engine (#279).
- Where: `.claude/skills/dm-encounter/SKILL.md` (Setting HP, max HP and armor class); `.claude/skills/dm-encounter/EVALS.md` (row "shadow 2 has 30 max HP and is at full").
- Revisit if: #279's full-HP rule is applied to exact max HP too.
- Status: active

## 284.4 `list_encounter` does not show armor class in this ticket

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: After `set_armor_class`, the agent cannot read the new AC back: `list_encounter` shows id, name, HP and initiative, and `get_statblock` shows the base monster's AC. The plan proposed an AC column as an addition.
- Options:
  - Chosen: keep it out; filed as follow-up #290 (part of epic #280).
  - Add an AC column to the `list_encounter` table here: changes a tool's output that sibling tickets may also touch.
- Where: `listEncounterTool` in `packages/mcp/src/tools.ts` (unchanged).
- Status: active
