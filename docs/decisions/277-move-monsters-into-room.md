# feature: move existing monsters' tokens into a named room

Issue: [#277](https://github.com/askrzypczak/ttrpg-agents/issues/277).

## 277.1 One PR, not split

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: the ticket asked for a split at the plan gate under the five-package rule (CLAUDE.md), expecting the protocol to change. The plan's Interfaces touch four packages (engine, store-sqlite, mcp, owlbear): the protocol reuses the engine's `encounterEventSchema` unchanged and the bridge broadcasts change-log rows without looking at their kind (spec audit).
- Options:
  - Chosen: one PR. The rule's condition is not met, so following it means not splitting.
  - Split by size: the store setter, the event and the extension's move first, then the use case, the tool and the skill. Costs one more run and review, and leaves `setSpawnPositions` and the extension's move without a production caller until the second ticket lands; the reviewer reads the whole diff either way.
- Where: this ticket's body (unchanged).
- Status: active

## 277.2 One batch setter stores the new spawn positions, all or nothing, with one event per instance

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that a new repository setter stores each new spawn position is the maintainer's (#277).
- Context: "move the wolves into the kitchen" changes several instances; a partial move would leave some tokens behind.
- Options:
  - Chosen: `EncounterRepository.setSpawnPositions(positions, origin)` writes every entry in one transaction and appends one `position-changed` event per entry; an id not in the active encounter throws `UnknownInstanceError` and nothing changes. It follows `removeInstances` (one transaction, one event per id).
  - One setter per instance, called in a loop: a failure part way leaves some monsters moved.
- Where: `EncounterRepository.setSpawnPositions` (`packages/engine/src/encounter/repository.ts`); `SqliteEncounterRepository.setSpawnPositions` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Status: active

## 277.3 A move is a new event kind, `position-changed`, not a field of `instance-changed`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: the extension must learn the new spawn position and that this command moved it.
- Options:
  - Chosen: `{ type: "position-changed", id, spawnPosition: { x, y }, origin }`, appended to `encounterEventSchema`. The protocol reuses it as the wire shape, so its version stays 1. The event carries only the new position (#283, undo, must record the previous one itself).
  - A `spawnPosition` field in `instance-changed.changes`: no new kind, but it mixes a move trigger into the edit-field event other tickets of the epic extend.
- Where: `encounterEventSchema` (`packages/engine/src/encounter/events.ts`); `fold` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 277.4 Each token records the position the extension last wrote to it; older tokens get none

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: the extension must tell a token the GM moved from one still where it was put (for the override note, 277.6), and notice a move it missed while offline.
- Options:
  - Chosen: the synced record (`com.ttrpg-agents/synced`) gets a reserved key `position` (`POSITION_BASELINE_KEY`, like `NAME_BASELINE_KEY`): the position written when the token is created (its spawn position or its default-row slot) and after each move. A token created before this change has none, and none is adopted, so a GM's earlier drag is never recorded as ours. It follows the synced-record baselines of 69.1; it is not the persisted record of kept values that 206.2 cut.
  - The previous spawn position kept in memory: no persisted key, but nothing is known about default-row tokens or after a reload, and a move made while the extension was offline never reaches the token.
- Where: `POSITION_BASELINE_KEY`, `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active

## 277.5 A token moves on the `mcp` event that set its spawn position, or when a snapshot's spawn position differs from its recorded position

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the extension moves each affected token once, as an explicit exception to "position is create-only", is the maintainer's (#277).
- Context: the picker is deterministic, so moving a monster the GM dragged out of a room back into it can store the same spawn position again; comparing values alone would then not move the token.
- Options:
  - Chosen: an `mcp` `position-changed` event adds its instance to a moves set that the next reconcile takes (and restores on failure); `planSync` moves an existing token when its instance is in `moves`, or when its recorded position differs from the spawn position (a move seen only in a snapshot). The token is written only when it is not already there; its recorded position becomes the spawn position either way. Without a spawn position, or without either trigger, an existing token is never moved.
  - Compare the spawn position with the recorded position only: simpler, but the same position set again is ignored.
  - Events only, no snapshot fallback: a move made while the extension was offline never reaches the token.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`); `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: a move made while offline sets the same position again (the snapshot cannot see it).
- Status: active

## 277.6 A move over a token that is off its recorded position, or has none, is listed in the panel's override list

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the overwrite is visible to the GM is the maintainer's (#277), and the rule that writes over table values are listed is the maintainer's (#209, 206.2).
- Context: a token's position belongs to the table after creation; the move overwrites it only on the DM's request, and the DM must be able to audit it.
- Options:
  - Chosen: when a move is planned and the token is not at its recorded position, the override list gets "<Name> was moved at the agent's request; its token had been moved on the table, and that position was overwritten."; with no recorded position (a token created before this change), "<Name> was moved at the agent's request; its token may have been moved on the table, and that position was overwritten." An ordinary move of a token still where it was put lists nothing. This extends 206.2's list to agent moves and narrows 50.7's aside that an existing token is never moved; 50.7's decision (which new tokens go in the default row) stands.
  - A note for every move: noisy, since the DM just asked for it in chat.
  - The tool's reply only: the engine cannot see which table token is whose (`TableToken` has no instance id).
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`); `#overrides` (`packages/owlbear/index.html`).
- Revisit if: the DM finds the notes noisy or misses moves.
- Status: active

## 277.7 `onSnapshotOverride` is renamed `onOverride`, and the override list's heading covers agent moves

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved (spec audit).
- Context: the callback now also fires on live reconciles, not only after snapshots.
- Options:
  - Chosen: rename it, updating `main.ts` and the tests that use it; widen the panel heading.
  - Keep the name with a wider doc comment: no test edits, but a misleading name.
- Where: `createEncounterSync` options (`packages/owlbear/src/encounter-sync.ts`); `packages/owlbear/src/main.ts`; `packages/owlbear/index.html`.
- Status: active

## 277.8 "Who owns what" gets its own token-position row

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the Position row is added or changed is the maintainer's (#277).
- Context: the row "Position, visibility, size and art of a token" was create-only for all four. #285 (change a monster's type) will make the same kind of exception for size and art.
- Options:
  - Chosen: split it into "Token position" (the move exception) and "Visibility, size and art of a token" (create-only), so #285 can split size and art beside it.
  - Reword the shared row: #285 would have to untangle it again.
- Where: `docs/architecture.md` (What reaches the table, Who owns what).
- Status: active

## 277.9 The named monsters' own tokens count as occupied cells

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: `moveMonstersIntoRoom` reads the occupied cells from `scene-tokens`, which reports bounds only (263.2's revisit condition: telling our tokens from others).
- Options:
  - Chosen: accept it. A monster moved within the room it is already in avoids its own cells and gets another free cell; a monster in another room is unaffected. Stated in the tool's README row.
  - Add the instance id to `TableToken` and the `scene-tokens` answer: touches the protocol, the extension's query and the port for a case no test shows blocking a real move.
- Where: `moveMonstersIntoRoom` (`packages/engine/src/map/place-monsters.ts`); `packages/mcp/README.md`.
- Revisit if: a move fails, or lands badly, because a moved monster's own token blocks the room.
- Status: active

## 277.10 A move's override note is reported as soon as the move is written

- Decided by: reviewer, 2026-10-26, review round 1 (blocker); the way the notes are told apart is the implementer's; not human-approved.
- Context: the extension reported every override note at the end of a successful reconcile. When the move write succeeded but a later write of the same reconcile failed, the retry found the token already moved, planned no note, and the overwrite never reached the panel (AC5).
- Options:
  - Chosen: `apply` reports a move's note through `onOverride` right after that token's `updateItems` succeeds; the end of a successful reconcile reports only the other overrides (the Stat Bubbles ones after a snapshot). The planner and the sync build and recognise the note text with one shared function, `moveOverrideNote` (a new export of `sync-plan.ts`, used only inside the extension), so `SyncPlan`'s shape is unchanged.
  - A list of pending notes that survives a failed reconcile: still needs a way to tell move notes from the Stat Bubbles ones.
  - A marker field on each `SyncPlan.overrides` entry: changes the plan's shape that the contract tests pin.
- Where: `moveOverrideNote`, `planSync` (`packages/owlbear/src/sync-plan.ts`); `apply` and `reconcile` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
