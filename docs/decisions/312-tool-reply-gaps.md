# bug: small gaps in Epic J tool replies (names, clamping, initiative reason, unlabeled flag)

Issue: [#312](https://github.com/askrzypczak/ttrpg-agents/issues/312).

## 312.1 `change_monster_type` names the monsters in `noLongerFits` and says why initiative changed

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved. That both must be said is the maintainer's (#312, 2026-10-26). That initiative keeps its roll with the new monster's modifier is the maintainer's (285.2, 2026-10-26).
- Context: `noLongerFits` listed instance ids, which the agent cannot read, and a changed monster's initiative moved (5 to 2) with no reason in the reply.
- Options:
  - Chosen: structured `noLongerFits` holds the new display names (ids stay in `instances`). A monster whose initiative changed gets the suffix "(kept roll R, modifier M)". The engine's `ChangedMonster.initiativeRoll` carries the kept d20 roll (null when the target had no initiative), because the engine owns the number; the modifier is the new initiative less that roll.
  - Names alongside ids: two lists for the same monsters.
  - Compute the roll in the adapter: it lacks the old monster's modifier.
- Where: `ChangedMonster` in `packages/engine/src/encounter/change-monster.ts`; `changeMonsterTypeTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 312.2 The exact-value setters say when the requested value was changed, by direction only

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved. That the reply says so is the maintainer's (#312, 2026-10-26). This extends 284.2 without reversing it: the engine still clamps and the reply still shows its value.
- Context: `set_hp` 999 on a monster at 15/15 replied "HP 15 -> 15/15", so the agent could not tell its request was changed.
- Options:
  - Chosen: when the applied value differs from the requested one the line ends with "(asked N, lowered to X)" or "(asked N, raised to X)", and for `set_hp` above max "lowered to max HP X". The adapter only compares two numbers; it holds no copy of the engine's ranges. Nothing is added when they are equal.
  - A structured `clamped: { requested, applied }` key: struck at the audit; the agent reads only `summary` (311.1), the request is its own input and the applied value is in `instance`.
  - Wording that names the range ("raised to the minimum 1"): a second copy of the ranges in the adapter, which 284.2 avoided.
  - Move the comparison into the engine: changes the repository ports and the store for no consumer.
- Where: `setHpTool`, `setMaxHpTool`, `setArmorClassTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 312.3 The map-moved flag is `mapMoved` in the structured result of every tool that returns it

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q1); not human-approved. That the flag needs a self-explanatory name is the maintainer's (#312, 2026-10-26).
- Context: `moved: false` in the structured result of `move_monsters`, `add_monsters` and `preview_monsters` reads as "no token moved"; it is the map-moved flag whose line the text shows only when true. `set_rooms`, `list_rooms` and `get_map_image` return the same flag under the same name.
- Options:
  - Chosen: rename to `mapMoved` in all of them (`use_map` returns no flag). The engine field `moved` and the text line stay.
  - Rename only the three tools the ticket names: one flag with two names on one server.
- Where: the tools above in `packages/mcp/src/tools.ts`.
- Status: active
