# feature: split or merge initiative groups after monsters are added

Issue: [#287](https://github.com/askrzypczak/ttrpg-agents/issues/287). Part of epic [#280](https://github.com/askrzypczak/ttrpg-agents/issues/280).

## 287.1 Splitting and merging are two tools, `split_initiative` and `merge_initiative`

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the ticket left the MCP shape to the plan ("tools or options").
- Options:
  - Chosen: two tools, named like `set_initiative` and `roll_initiative`, each with `targets`; `split_initiative` takes an optional `roll`. They match the DM's words ("each act on their own", "act together now").
  - One tool with an `action` enum: one contract with two meanings.
  - Options on `roll_initiative`: its contract is rolling, and a merge does not roll.
- Where: `splitInitiativeTool`, `mergeInitiativeTool` in `packages/mcp/src/tools.ts`; "Changing initiative" in `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 287.2 A merge adopts the first named monster's current initiative without rolling; a split keeps each value unless the DM asks to roll

- Decided by: epic #280 orchestrator, 2026-10-26, before the plan gate; not human-approved.
- Context: the ticket asked the plan to choose the merged group's shared value (for example the first named monster's, or a new roll), and whether a split rolls.
- Options:
  - Chosen: the merge takes the first named monster's value and rolls nothing; a split keeps each value, and with `roll` rolls each its own through #180's shared roll. `roll_initiative` exists for a DM who wants a fresh shared roll, so a merge should not re-roll by surprise. #286 (join an existing group) also takes a named member's current value.
  - A new shared roll on every merge: replaces values the DM may have set on purpose.
  - Always roll on a split: same cost for the split monsters.
- Where: `mergeInitiative`, `splitInitiative` in `packages/engine/src/encounter/initiative-groups.ts`.
- Status: active

## 287.3 When the first named monster has no initiative, the merge uses the first named one that has a value

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (question from the work-ticket orchestrator); not human-approved.
- Context: an instance's initiative can be null, for example after the GM removes its token from the Initiative Tracker.
- Options:
  - Chosen: (a) the first named instance that has an initiative gives the shared value; when none has one, no initiative is written and the reply says "unset".
  - (b) Adopt null and clear the other members' values: writes over values the DM did not ask to clear.
  - (c) Refuse the merge with a new typed error: blocks a harmless request and adds an error class.
- Where: `mergeInitiative` in `packages/engine/src/encounter/initiative-groups.ts`.
- Status: active

## 287.4 Split and merge give fresh group ids: a split gives each named instance its own, a merge one for exactly the named instances

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: a merge could reuse the first named instance's group id, and a split could clear the group (`null` also rolls alone). `setGroupId` takes a group id, never null.
- Options:
  - Chosen: `newGroupId()` per split instance and once per merge. The merged group is exactly the named instances; members of an old group the DM did not name stay in it. A split instance keeps a group id, so #286 can later add monsters to its group.
  - Reuse the first named instance's group id on a merge: silently pulls in that group's unnamed members without changing their initiative.
  - Clear the group (`null`) on a split: no group for #286 to join, and the setter would need a nullable id.
- Where: `splitInitiative`, `mergeInitiative` in `packages/engine/src/encounter/initiative-groups.ts`; `EncounterRepository.setGroupId` in `packages/engine/src/encounter/repository.ts`.
- Status: active

## 287.5 Split and merge write only what changes

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: an `mcp` initiative event drops a held table edit of that field (`docs/architecture.md`, "Only the MCP writes the table"), so writing an unchanged initiative can override a GM's edit that is still settling.
- Options:
  - Chosen: a merge calls `setInitiative` only for a member whose value differs from the shared one; a split without `roll` writes no initiative. Group changes always write, and the extension does not project `groupId`.
  - Write every member's initiative: simpler, but a monster whose value the merge does not change could lose a pending table edit.
- Where: `mergeInitiative`, `splitInitiative` in `packages/engine/src/encounter/initiative-groups.ts`.
- Status: active

## 287.6 A rolled split rolls with `rollInitiativeValues` before any write, not through `rollInitiative`

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: an unknown monster must change nothing, groups included.
- Options:
  - Chosen: check every id, roll with `rollInitiativeValues(deps, targets, "each")` (which checks every monster before the first roll), then write each instance's group and initiative.
  - Write the groups, then call `rollInitiative`: an unknown monster would fail after the groups were written.
- Where: `splitInitiative` in `packages/engine/src/encounter/initiative-groups.ts`.
- Status: active

## 287.7 A group mixing monster types shares one roll with its first item's monster

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: 180.7 chose this rule provisionally until this ticket decided a merged group's shared value. Merging can now put different monster types in one group.
- Options:
  - Chosen: keep the rule and make it final, pinned by a test: the shared roll uses the first item of the roll's input for its modifier and label. That is the merge's first named monster only when the DM names them in the same order; the skill's merge rule names the group's anchor first, and a re-roll uses whatever order the DM names.
  - One shared d20 with each member's own modifier: the members' values differ, but a merged group shares one value.
  - Refuse merges of different monster types: blocks "the wolves act with the goblins".
- Where: `rollInitiativeValues` in `packages/engine/src/encounter/initiative.ts`.
- Supersedes: 180.7
- Status: active

## 287.8 A group-mode roll naming only some members of a group still rolls only the named (180.3 stands)

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: 180.3 said to revisit if this ticket made group membership something the DM manages and expects a group to stay aligned.
- Options:
  - Chosen: no change. Split and merge make membership explicit, but nothing here keeps a group aligned on its own; the DM realigns one with `merge_initiative`.
  - Widen a partial roll to the whole stored group: rolls monsters the DM did not name.
- Where: `rollInitiative` in `packages/engine/src/encounter/initiative.ts` (unchanged).
- Status: active

## 287.9 The group setter and its event are an acceptance criterion

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (question raised by the spec-auditor); not human-approved.
- Context: the ticket's Proposed change requires the setter and its event ("A setter still needs an event... the event shape gains the field") but its acceptance criteria do not list them.
- Options:
  - Chosen: (a) add it as an AC: `EncounterRepository.setGroupId` stores the group and records an `instance-changed` event carrying `groupId` and the call's origin, which `encounterEventSchema` parses.
  - (b) Leave it out and map its tests to the split and merge criteria.
- Where: `setGroupId` in `packages/engine/src/encounter/repository.ts` and `packages/store-sqlite/src/sqlite-repository.ts`; `instance-changed` in `packages/engine/src/encounter/events.ts`.
- Status: active

## 287.10 Split and merge use ids as given and do not remove duplicates

- Decided by: implementer, 2026-10-26, implementation; kept by the work-ticket orchestrator at review round 1 (the reviewer asked for it to be recorded); not human-approved.
- Context: the plan did not say what the use cases do with an id given twice. The MCP removes duplicates through `resolveTargets`, as for `rollInitiative` (180.8).
- Options:
  - Chosen: ids are used as given. Only an engine caller other than the MCP could pass one twice: a split would give it two fresh groups in turn (and with `roll` roll it twice), and a merge could write its initiative twice, because each pass compares against the value read before the call.
  - Remove duplicate ids in the use cases: one more rule for a case no caller produces.
- Where: `splitInitiative`, `mergeInitiative` in `packages/engine/src/encounter/initiative-groups.ts`.
- Revisit if: an engine caller other than the MCP passes ids it has not resolved.
- Status: active
