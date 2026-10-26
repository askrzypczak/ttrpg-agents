# feature: correct a monster's max HP after it was added (average or re-roll) from the MCP

Issue: [#279](https://github.com/askrzypczak/ttrpg-agents/issues/279).

## 279.1 Resetting max HP keeps a monster at full HP at full; a damaged monster keeps its current HP, lowered to the new max if above it

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, confirming the rule the maintainer proposed in the ticket; not human-approved.
- Context: `setMaxHp` lowers current HP above the new max but never raises it (`resizeMaxHp`), so an undamaged wolf going from a rolled 8 to an average 11 would end at 8/11. The ticket left the rule to the plan.
- Options:
  - Chosen: an instance at full HP (current = max, read inside the `setMaxHp` write) ends at full HP at the new max; any other instance keeps its current HP, lowered to the new max if above it.
  - `setMaxHp` alone: the undamaged wolf ends 8/11 and the DM has to set its HP as well.
  - Keep the damage taken (current = new max - damage): a lower max can drop a monster to 0, a higher one can revive it.
  - Always full: loses damage the DM already applied.
- Where: `resetMaxHp` in `packages/engine/src/encounter/max-hp.ts`. `setMaxHp`, `resizeMaxHp` and table edits keep their behaviour.
- Revisit if: the same rule is wanted for exact max HP (`set_max_hp`, see 284.3).
- Status: active

## 279.2 The correction is one MCP tool `reset_max_hp` (use case `resetMaxHp`) with a required `hp` of `average` or `rolled`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: The ticket left the tool and use case names to the plan (for example `set_hp_mode` or `reset_max_hp`). `add_monsters` takes an optional `hp` that defaults to `rolled`.
- Options:
  - Chosen: `reset_max_hp`, next to `set_max_hp`, saying what changes; `hp` is required.
  - `set_hp_mode`: suggests the mode is stored on the instance, which the ticket rules out.
  - `reroll_hp`: wrong for the average case.
  - `hp` optional with `rolled` as the default, like `add_monsters`: a call that names no mode would re-roll by surprise.
- Where: `resetMaxHpTool` and `tools` in `packages/mcp/src/tools.ts`; `resetMaxHp` in `packages/engine/src/encounter/max-hp.ts`; `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 279.3 All-or-nothing across targets comes from validating every id and monster key before any roll or write

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: An unknown instance or a monster key not in the index must fail and change nothing for any target. The `EncounterRepository` port has no transaction that spans several setter calls.
- Options:
  - Chosen: read the instances once, throw `UnknownInstanceError` or `UnknownMonsterError` before any roll or write, then roll and write each instance (as `set_stats_visibility` and #180's `rollInitiative` do).
  - A batch port method that writes every instance in one transaction: a port change for a gap that only a store failure in the middle of the writes would expose.
- Where: `resetMaxHp` in `packages/engine/src/encounter/max-hp.ts`.
- Revisit if: the port gains a multi-write transaction (for example for undo, #283).
- Status: active

## 279.4 The full-HP rule is written as `setMaxHp` then `setHp` under one command id

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: Raising the max of a full instance takes two values: the new max and current HP raised to it. `setMaxHp` never raises current HP.
- Options:
  - Chosen: `setMaxHp`, then `setHp` to the new max only when the instance was full and no longer is, both with the caller's origin. The change log gets two `hp-changed` events for that instance (8/11, then 11/11) under one command id.
  - A new port method that sets both in one write: changes the port, the SQLite store and every repository fake; the ticket keeps `setMaxHp`.
- Where: `resetMaxHp` in `packages/engine/src/encounter/max-hp.ts`.
- Revisit if: the intermediate event shows up on the table or an undo of one command (#283) needs a single event.
- Status: active

## 279.5 The shared HP roll `rollMaxHp` is engine-internal; only `resetMaxHp` and its two types are public

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, on the spec audit's reword; not human-approved.
- Context: The HP roll moves out of `addMonsters` so the use case can share it. #180 made its shared initiative roll public because #287 names it as a consumer; no adapter or sibling ticket names the HP roll.
- Options:
  - Chosen: `rollMaxHp`, `MaxHpRollDeps` and `MaxHpRoll` are exported from `max-hp.ts` only, imported by `add-monsters.ts`; `encounter/index.ts` exports `resetMaxHp`, `ResetMaxHpDeps` and `ResetMaxHpResult`.
  - Export everything from `@ttrpg-agents/engine`, like #180's roll: a public API with no outside consumer.
- Where: `packages/engine/src/encounter/max-hp.ts`; `packages/engine/src/encounter/index.ts`.
- Revisit if: an adapter needs a max HP before an instance exists (for example a preview, #288).
- Status: active
