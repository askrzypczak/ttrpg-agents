# feature: preview monsters before adding them

Issue: [#288](https://github.com/askrzypczak/ttrpg-agents/issues/288). Part of epic [#280](https://github.com/askrzypczak/ttrpg-agents/issues/280).

## 288.1 The preview keeps the placement part: with a room it reports the cells or "No free cell left"

- Decided by: maintainer (ticket #288 body) for the preview and its placement; epic #280 orchestrator, 2026-10-26, before the plan gate, for keeping the placement once undo exists; not human-approved.
- Context: the ticket let the plan drop the placement part if undo (#283) covers the need.
- Options:
  - Chosen: keep it. "Would 2 trolls fit in the attic?" is answered before anything is added, which undo cannot do.
  - Drop it and rely on undo: the DM adds, looks at the table and undoes; the tokens appear and vanish, and the question is answered only after the fact.
- Where: `previewMonstersInRooms` in `packages/engine/src/map/place-monsters.ts`.
- Status: active

## 288.2 A separate read-only tool, `preview_monsters`, takes exactly the `add_monsters` input

- Decided by: epic #280 orchestrator, 2026-10-26, before the plan gate, for the separate tool with `readOnlyHint: true` and a shared `groups` schema; work-ticket orchestrator, 2026-10-26, plan gate, for sharing the whole input shape (`initiative` too), approved by the epic #280 orchestrator; not human-approved.
- Context: the ticket left the MCP shape open: a `preview` option on `add_monsters` or a separate tool.
- Options:
  - Chosen: a separate tool annotated `readOnlyHint: true`, so MCP clients treat it as a read and the skill maps "what would ... look like" to its own verb. The `add_monsters` input shape (`groups` and `initiative`) is one module-private constant used by both tools, so they cannot drift and zod rejects the same arguments with the same message. `initiative` only validates in a preview, since nothing is rolled.
  - A `preview` option on `add_monsters`: one tool whose annotations would have to cover both a write and a read, and an easy-to-miss flag between a preview and an add.
  - Share only `groups`: `initiative` would be stripped by zod in the preview, so an invalid `initiative` would fail an add but not its preview.
- Where: `addMonstersInput`, `addMonstersTool` and `previewMonstersTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 288.3 The preview mirrors every `add_monsters` feature, `join` included, and shows the names an add would give

- Decided by: epic #280 orchestrator, 2026-10-26, before the plan gate; not human-approved.
- Context: by the time this ticket runs, `add_monsters` has rooms (#50), footprints (#189) and `join` (#286).
- Options:
  - Chosen: the preview takes every group field. A group with `join` shows the member's name and its current initiative (null included) instead of a modifier to roll. Names come from the add's naming strategy against the names in use, so the preview shows the names the next add of the same input gives.
  - Leave `join` out of the preview: "what would one more wolf look like" could not be previewed, and the preview's arguments would differ from the add's.
- Where: `previewMonsters` in `packages/engine/src/encounter/add-monsters.ts`; `JoinTarget.name` in `packages/engine/src/encounter/validate-add-monsters.ts`.
- Status: active

## 288.4 Nothing is written, rolled or recorded, and the preview's dependencies cannot do so

- Decided by: maintainer (ticket #288 body: "without writing or rolling") and epic #280 orchestrator, 2026-10-26, before the plan gate, for the test with the store, the change log and a counting rng; work-ticket orchestrator, 2026-10-26, plan gate, for the dependency type and (from the spec audit) where each part is proven, approved by the epic #280 orchestrator; not human-approved.
- Context: a preview that consumed randomness would change the next add's rolls; one that wrote would create tokens on the table.
- Options:
  - Chosen: `previewMonsters` takes `{ repo: Pick<EncounterRepository, "listInstances">, monsters, naming? }`: no `rng`, `now` or `newGroupId`, so it cannot roll, timestamp or mint a group id, and its only store access is a read. The engine tests prove the store is untouched; the MCP test proves the SQLite change log and a counting rng in the tool context are untouched (the engine has no rng to count).
  - Take the full `AddMonstersDeps` and promise not to use the rng: only a test would hold the promise.
- Where: `PreviewMonstersDeps` in `packages/engine/src/encounter/add-monsters.ts`; `previewMonstersInRooms` in `packages/engine/src/map/place-monsters.ts`.
- Status: active

## 288.5 The dry run shares the add's code through module-private helpers, not a copy

- Decided by: epic #280 orchestrator, 2026-10-26, before the plan gate, for sharing rather than copying; work-ticket orchestrator, 2026-10-26, plan gate, for the helpers' split, approved by the epic #280 orchestrator; implementer, 2026-10-26, for planning every group before the first roll; not human-approved.
- Context: the preview must give the same errors, names, joins, footprints and cells as the add. `addMonsters` builds its items inside the store transaction, interleaving naming with HP rolls.
- Options:
  - Chosen: the part of `addMonsters` that rolls nothing (names, HP mode, footprint, stats visibility, spawn position, join target) moves into a module-private `planAddMonsters`; `addMonsters` calls it inside the transaction with the transaction's names and then rolls in the same order as before, and `previewMonsters` calls it with the names read from the store. The placement part of `addMonstersInRooms` (the map in use, the rooms, the table reads, the block picks, the cell labels) moves into module-private helpers in `place-monsters.ts` that both room use cases call. The existing tests of the add path stay byte-identical.
  - Copy the steps into the preview: two copies of the naming, stats-visibility and placement rules that would drift.
  - Plan one group at a time, between that group's rolls (implementer, weighed and not chosen): keeps naming and `newGroupId()` interleaved per group as before, but needs the helper to run per group. With the chosen helper, `addMonsters` names every group before its first `newGroupId()` call; rolls, `now()` and `newGroupId()` keep their order, and the change is visible only to an injected naming strategy with side effects (reviewer, round 1, checked line by line).
  - Export the helpers: package API whose only consumers are inside the engine.
- Where: `planAddMonsters`, `addMonsters`, `previewMonsters` in `packages/engine/src/encounter/add-monsters.ts`; the placement helpers, `addMonstersInRooms`, `previewMonstersInRooms` in `packages/engine/src/map/place-monsters.ts`.
- Status: active

## 288.6 Two engine entry points, mirroring `addMonsters` and `addMonstersInRooms`

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: placement needs the table (async); the rest of the preview needs only the store (sync). 50.3 split the add the same way.
- Options:
  - Chosen: `previewMonsters` (sync, `add-monsters.ts`) and `previewMonstersInRooms` (async, `place-monsters.ts`), which without any room returns `previewMonsters`' result and asks no table, so a preview without a room works with the bridge down.
  - One async function in `place-monsters.ts` with the no-room logic inline: encounter planning in the map module, and the planning helper would have to be exported from `add-monsters.ts`.
- Where: `packages/engine/src/encounter/add-monsters.ts`, `packages/engine/src/map/place-monsters.ts`.
- Status: active

## 288.7 A preview instance carries no monster key and no group id

- Decided by: spec audit (cut), folded in by the work-ticket orchestrator; epic #280 orchestrator, 2026-10-26, plan gate, kept the cut; not human-approved.
- Context: `AddedInstance` has `monsterKey` and `groupId`. The preview's reply prints name, AC, HP, initiative (with the member's name for a joined group) and footprint.
- Options:
  - Chosen: `PreviewInstance` has `name`, `group` (input index), `ac`, `averageHp`, `hpDice`, `initiativeModifier`, `joins` (`{ name, initiative }` or null) and `footprint`. The member's name and current initiative are how the preview shows "the member's group"; the caller already has the key it passed.
  - Mirror `AddedInstance` (keep `monsterKey` and `joins.groupId`): fields nothing reads.
- Where: `PreviewInstance` in `packages/engine/src/encounter/add-monsters.ts`.
- Status: active

## 288.8 The reply opens with "Preview only: nothing was added or rolled." and mirrors the add's table and room lines

- Decided by: maintainer (ticket #288 body: "The reply says nothing was added", "cells or 'No free cell left'"); the format by the work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: the preview's table looks like an add's, so the reply must not read as an add.
- Options:
  - Chosen: the first line is "Preview only: nothing was added or rolled.", then a table of name, AC, HP (average with the dice), initiative (the signed modifier, or for a joined group the member's initiative, `-` when unset, and its name) and footprint (cells per side), then per group with a room "Would be placed in <Room>: ..." and "No free cell left in <Room> for ...", split by input group as 50.8 splits the add's lines, then the moved-map line.
  - The disclaimer at the end: easy to miss after a table that looks like an add.
- Where: `previewMonstersTool` in `packages/mcp/src/tools.ts`. The room lines find each placement's group by the would-be monster's name (names are unique in a preview), so `PreviewPlacement` carries no group index (implementer); the run splitting is one helper shared with the `add_monsters` reply (reviewer, round 1).
- Status: active

## 288.9 For a preview, the skill relays an unknown-room error and asks, and fetches no statblock unless asked

- Decided by: work-ticket orchestrator, 2026-10-26, plan gate, approved by the epic #280 orchestrator; not human-approved.
- Context: for `add_monsters`, an unknown room starts the live steps under Proposing rooms, which save a proposed room. The add shows a new type's statblock.
- Options:
  - Chosen: a preview stores nothing, so on an unknown room the skill relays the error (it lists the known rooms) and asks where the room is, without proposing or saving one; it calls `get_statblock` only when the DM asks what the monster does.
  - Follow the live room steps for a preview too: a "preview" that saves a room.
- Where: "Previewing an add" in `.claude/skills/dm-encounter/SKILL.md`; row 39 in `.claude/skills/dm-encounter/EVALS.md`.
- Status: active
