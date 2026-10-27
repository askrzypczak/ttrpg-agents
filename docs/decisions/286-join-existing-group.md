# feature: add monsters to an existing group ("make it 3 wolves, not 2")

Issue: [#286](https://github.com/askrzypczak/ttrpg-agents/issues/286). Part of epic [#280](https://github.com/askrzypczak/ttrpg-agents/issues/280).

## 286.1 Joining is an optional per-group `join` field on `add_monsters`, not a separate tool

- Decided by: epic #280 orchestrator, 2026-10-26, before the plan gate; not human-approved.
- Context: the ticket left the MCP shape open: a group field naming an existing member, or a separate tool.
- Options:
  - Chosen: `join` on each `add_monsters` group (and on `AddMonstersGroup` in the engine), naming a monster already in the encounter by id or exact name. "One more goblin" stays one call, and one call can mix joined and new groups. #288's preview mirrors `addMonsters`, so it gets the field with no second tool to copy.
  - A separate tool: two calls for a sentence that mixes a new group and a joined one, and a second tool for the preview to mirror.
- Where: `AddMonstersGroup.join` in `packages/engine/src/encounter/add-monsters.ts`; `addMonstersTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 286.2 Joined monsters take the member's group and current initiative, null included, and roll no initiative

- Decided by: maintainer (ticket #286 body) for the group and the member's current initiative with no roll; epic #280 orchestrator, 2026-10-26, before the plan gate, for "null included" and for both initiative modes; not human-approved.
- Context: members of a group can hold different values after `set_initiative`, and a member can have none (the GM removed its token from the Initiative Tracker, or a merge left it unset).
- Options:
  - Chosen: the joined monsters take the named member's `groupId` and its current initiative as stored, null included, in `group` and `each` mode alike; their roll lines have no initiative roll. `AddedInstance.initiative` widens to `number | null`.
  - Refuse to join a member with no initiative: a new failure for a harmless request.
  - Roll for the joined monsters when the member has none: an initiative the DM did not ask for, and a group holding different values.
- Where: `addMonsters` in `packages/engine/src/encounter/add-monsters.ts`.
- Status: active

## 286.3 A group with `join` rolls no initiative, an exception to 180.4

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate (from the spec audit), approved by the epic #280 orchestrator; not human-approved.
- Context: 180.4 has `addMonsters` call `rollInitiativeValues` once per add-group, so that a repeated injected group id cannot merge two add-groups' rolls.
- Options:
  - Chosen: a group with `join` makes no `newGroupId()` call and no `rollInitiativeValues` call; every other group keeps 180.4's one call per group. 180.4's reason does not apply when nothing is rolled, so it is not superseded.
  - Pass joined items to `rollInitiativeValues` and override its result: an rng draw and a roll log entry for a value that is then thrown away.
- Where: `addMonsters` in `packages/engine/src/encounter/add-monsters.ts`.
- Status: active

## 286.4 The engine resolves `join` by id, else exact name; the MCP passes it through

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: 180.5 has `rollInitiative` take instance ids, with names resolved in the MCP by `resolveTargets`, as every MCP mutation tool does.
- Options:
  - Chosen: `findJoinTargets` in the engine matches by instance id first, else by exact display name (the `resolveTargets` rule). Departs from 180.5's pattern for this field: the reference sits inside an add group, `addMonstersInRooms` already resolves room names inside the same call, and #288's preview mirrors `addMonsters` with no adapter step to copy.
  - The MCP resolves the name to an id first, as in 180.5: a resolution step in the adapter that the preview would have to repeat, and an engine error that the MCP path could never reach.
- Where: `findJoinTargets` in `packages/engine/src/encounter/validate-add-monsters.ts`; `addMonstersTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 286.5 A `join` that matches nothing, matches several by name, or names a member with no group fails with `AddMonstersError` `unknown_group`

- Decided by: maintainer (ticket #286 body: "fails with a typed domain error and adds nothing") for the failure; the code and its cases by the work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the group is identified by a member. A member's `groupId` can be null only for rows stored outside `addMonsters` (`addMonsters` and #287's split and merge always set one).
- Options:
  - Chosen: a new `AddMonstersErrorCode` `unknown_group`, with a message that names the group and the reference, for all three cases. Nothing is rolled or written, and on the room path the table is not asked (50.4's order: every input check before the table read).
  - Let `resolveTargets`' `TargetError` through: its message has no group context, and it is not an add-validation code.
  - Give the joined monsters a fresh group when the member has none: they would share the member's initiative but not its group, so a later group roll would split them.
- Where: `findJoinTargets` and `AddMonstersErrorCode` in `packages/engine/src/encounter/validate-add-monsters.ts`; its call in `addMonstersInRooms` (`packages/engine/src/map/place-monsters.ts`).
- Status: active

## 286.6 Any monster type may join a group

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: a group can already mix monster types after #287's `merge_initiative`.
- Options:
  - Chosen: no check that the joining monster's key matches the member's. "Add a goblin boss that acts with the goblins" is one call; the skill passes the member's own key for "one more X".
  - A typed error when the keys differ: blocks a mixed group the DM can build anyway with an add and a merge.
- Where: `findJoinTargets` in `packages/engine/src/encounter/validate-add-monsters.ts`.
- Status: active

## 286.7 A joined group that does not set `statsVisible` takes the member's stored value

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (override of the plan's proposal); not human-approved.
- Context: the ticket says nothing about stats visibility. The plan proposed the usual default (GM-only).
- Options:
  - Chosen: inherit the member's stored `statsVisible` when the group does not set it; a group that sets it keeps its own; a group without `join` keeps today's default. "Make it 3 wolves" on a pack whose Stat Bubbles the players can see should not produce one hidden wolf the DM has to notice and fix. The stored value is the best the engine has, since a visibility toggle on the table is not written back.
  - Not inherited: the group's field with the GM-only default, as for any group (the plan's proposal).
- Where: `JoinTarget.statsVisible` and `addMonsters` in `packages/engine/src/encounter/`.
- Revisit if: table toggles of the Stat Bubbles `hide` are ever written back to the store.
- Status: active

## 286.8 Placement stays as today: the room the DM names, else the default row

- Decided by: epic #280 orchestrator, 2026-10-26, before and at the plan gate; not human-approved.
- Context: the ticket suggested placing joined monsters next to the group's tokens when no room is named.
- Options:
  - Chosen: a joined group is placed like any group: in the room the DM names (`room`), else in the extension's default row. A joined group without a room asks no table, so it works with the bridge down.
  - Place it in the saved room holding the member's stored spawn position: needs the table query (and so the bridge) for a call that works without it today, and the stored spawn is where the agent last put the token, not where the GM dragged it. Not filed: not needed for the epic.
- Where: `addMonstersInRooms` in `packages/engine/src/map/place-monsters.ts` (unchanged placement).
- Status: active

## 286.9 "N more X" joins the existing group too, so EVALS row 10 expects `join`

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the maintainer's rule names "one more goblin" and "make it 3 wolves". "Add 2 more shadows" (EVALS row 10) is the same request with a larger count.
- Options:
  - Chosen: "one more X", "N more X" and "make it N X" for a monster already in the encounter all join its group; row 10 now expects `add_monsters` with `join`.
  - Join only on "one more X" and "make it N X": "2 more shadows" would roll its own initiative while "one more shadow" would not.
- Where: "More or fewer of a monster" in `.claude/skills/dm-encounter/SKILL.md`; rows 10 and 37 in `.claude/skills/dm-encounter/EVALS.md`.
- Status: active

## 286.10 The `add_monsters` reply leaves out `Rolls:` when nothing was rolled

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: before this ticket every add rolled initiative, so the roll list was never empty. A call whose only groups join with average HP rolls nothing.
- Options:
  - Chosen: the `Rolls:` header and its blank line are left out when there are no rolls.
  - Keep a `Rolls:` header with nothing under it.
- Where: `addMonstersTool` in `packages/mcp/src/tools.ts`.
- Status: active
