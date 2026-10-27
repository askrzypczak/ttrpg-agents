# feature: roll or re-roll a monster's initiative from the MCP

Issue: [#180](https://github.com/askrzypczak/ttrpg-agents/issues/180). Part of epic [#280](https://github.com/askrzypczak/ttrpg-agents/issues/280).

## 180.1 Rolling initiative is a separate `roll_initiative` tool, not an option on `set_initiative`

- Decided by: epic #280 orchestrator, 2026-10-26, answering the ticket's open question before the plan gate; not human-approved.
- Context: the ticket left the tool shape open. `set_initiative` (#176) sets an exact value the DM gives.
- Options:
  - Chosen: a new `roll_initiative` tool taking `targets` and an optional `mode`. The `dm-encounter` skill maps "roll" and "re-roll" to a distinct verb, and `set_initiative` keeps its exact-value contract.
  - A roll option on `set_initiative`: one tool fewer, but its `initiative` argument becomes optional and its contract depends on a flag.
- Where: `rollInitiativeTool` in `packages/mcp/src/tools.ts`; "Changing initiative" in `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 180.2 Named targets are always rolled, whether or not they have a value

- Decided by: epic #280 orchestrator, 2026-10-26, answering the ticket's open question before the plan gate; not human-approved.
- Context: the ticket asked whether a target that already has a value is re-rolled by default, or only monsters with no initiative unless the DM names them.
- Options:
  - Chosen: every named target is rolled. The DM named them; a monster with no initiative is covered by naming it.
  - Roll only monsters with no initiative by default: a re-roll would need an extra flag, and "roll initiative for the wolves" would silently skip wolves that have a value.
- Where: `rollInitiative` in `packages/engine/src/encounter/initiative.ts`.
- Status: active

## 180.3 A group-mode roll that names only some members of a stored group rolls only the named monsters

- Decided by: epic #280 orchestrator, 2026-10-26, at the plan gate (question raised by the spec-auditor); not human-approved.
- Context: in group mode, monsters sharing a stored `groupId` share one roll. "Roll initiative for Goblin Warrior 1" when Goblins 1-3 share a `groupId` leaves the group holding different values.
- Options:
  - Chosen: (a) roll only the named monsters. It follows 180.2; "re-roll the goblins" names all three through the skill rule; a group whose members hold different values is already possible after `set_initiative` on one member; #287 adds split and merge for a DM who wants the group realigned.
  - (b) Widen the roll to the whole stored group: rolls monsters the DM did not name.
  - (c) Refuse a partial group and suggest `mode: "each"`: a new error and friction on a common one-monster re-roll.
- Where: `rollInitiative` and `rollInitiativeValues` in `packages/engine/src/encounter/initiative.ts`.
- Revisit if: #287 makes group membership something the DM manages explicitly and expects a group to stay aligned.
- Status: active

## 180.4 The shared roll is `rollInitiativeValues` in a new module, and `addMonsters` calls it once per add-group

- Decided by: epic #280 orchestrator, 2026-10-26 (export from `encounter/index.ts` for #287); the module and call-site shape by the work-ticket orchestrator at the plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the roll was a closure inside `addMonsters`. The ticket's use case and #287 (split or merge groups) need the same roll; #279, #286 and #288 edit `add-monsters.ts` next, so the extraction had to stay small.
- Options:
  - Chosen: `rollInitiativeValues(deps, instances, mode)` in `packages/engine/src/encounter/initiative.ts`, taking `{ monsterKey, displayName, groupId? }` items (both `NewMonsterInstance` and `MonsterInstance` fit) and grouping by `groupId`. `addMonsters` replaces its closure with one call per add-group at the same place in the loop, so the rng order (the group's HP rolls, then its initiative) and the labels are unchanged, and a repeated injected group id cannot merge two add-groups.
  - One call over all of `addMonsters`' items after the loop: changes the rng order and roll log order, and depends on `newGroupId` returning distinct ids.
  - Keep the closure and duplicate the roll in the use case: ruled out by the ticket's AC.
- Where: `rollInitiativeValues`, `InitiativeRollInput`, `InitiativeRollDeps`, `InitiativeRollOutcome`, `InitiativeRollResult` in `packages/engine/src/encounter/initiative.ts`; `addMonsters` in `packages/engine/src/encounter/add-monsters.ts`.
- Status: active

## 180.5 The `rollInitiative` use case takes instance ids; the MCP resolves names

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the MCP tool takes ids or exact names. Either the use case resolves them or the adapter does.
- Options:
  - Chosen: the use case takes ids and throws `UnknownInstanceError` for an unknown one; the MCP resolves names with the engine's `resolveTargets`, as every MCP mutation tool does, and an unknown or ambiguous name fails with `TargetError` before anything changes.
  - The use case takes names and resolves them itself: the first use case to do so, unlike the repository setters and `applyInstanceEdit`.
- Where: `rollInitiative` in `packages/engine/src/encounter/initiative.ts`; `rollInitiativeTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 180.6 An instance whose monster is not in the index fails with a new `UnknownMonsterError` in `errors.ts`

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate (location from the spec-auditor's verdict), approved by the epic #280 orchestrator; not human-approved.
- Context: the ticket asks for a typed domain error for a monster key missing from the index. #279 (max HP re-roll) has the same criterion.
- Options:
  - Chosen: `UnknownMonsterError` (code `unknown_monster`) in `packages/engine/src/encounter/errors.ts`, next to `UnknownInstanceError`, so #279 imports it from the errors module.
  - Define it in `initiative.ts`: #279 would import an HP error from the initiative module.
  - Reuse `AddMonstersError("unknown_monster")`: misnamed outside an add.
- Where: `UnknownMonsterError` in `packages/engine/src/encounter/errors.ts`; thrown by `rollInitiativeValues`.
- Status: active

## 180.7 A group mixing monster types uses its first item's monster for the shared roll, provisionally

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate (the spec-auditor asked to leave the choice to #287), approved by the epic #280 orchestrator; not human-approved.
- Context: no group mixes monster types before #287 adds merging, but the code must handle any input. #287's ticket says its plan decides the shared value of a merged group.
- Options:
  - Chosen: the shared roll uses the first item's monster for its modifier and label, marked provisional in the doc comment; no test pins it.
  - Group by `groupId` and monster key: a mixed group would no longer share one value, which is what #287 asks of a merged group.
  - One shared d20 with each instance's own modifier: the members' values differ.
- Where: `rollInitiativeValues` in `packages/engine/src/encounter/initiative.ts`.
- Revisit if: #287 decides how a merged group's shared value is rolled.
- Status: superseded by 287.7

## 180.8 Rolls follow the input order, and `rollInitiative` does not remove duplicate ids

- Decided by: implementer, 2026-10-26, implementation; kept by the work-ticket orchestrator at review round 1 (the reviewer noted the duplicate case); not human-approved.
- Context: the plan fixed group rolls in first-seen order but not where an ungrouped item's roll falls, nor what happens to an id given twice.
- Options:
  - Chosen: one pass in input order, so an ungrouped item's roll sits between group rolls where it appears; ids are used as given. The MCP removes duplicates through `resolveTargets`, so only another engine caller could pass one twice, and in each mode it would roll and write twice.
  - All group rolls first, then the ungrouped ones: a second pass with no consumer asking for it.
  - Remove duplicate ids in the use case: one more rule for a case no caller produces.
- Where: `rollInitiativeValues` and `rollInitiative` in `packages/engine/src/encounter/initiative.ts`.
- Revisit if: an engine caller other than the MCP passes ids it has not resolved.
- Status: active
