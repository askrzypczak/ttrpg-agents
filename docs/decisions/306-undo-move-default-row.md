# feature: undo a move back to the default row

Issue: [#306](https://github.com/askrzypczak/ttrpg-agents/issues/306).

## 306.1 A cleared spawn position is a `position-changed` event with a null spawn position, written by `setSpawnPositions` with null

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that undo needs a nullable `position-changed` or a new event kind, and a store setter that can clear the spawn position, is the maintainer's (#306, 2026-10-26).
- Context: `setSpawnPositions` took a point and `position-changed` required one (277.2, 277.3), so undo could not put back a monster's "no spawn position".
- Options:
  - Chosen: `position-changed.spawnPosition` is nullable and `EncounterRepository.setSpawnPositions` takes `Point | null`; null clears the columns and logs `spawnPosition: null`. The protocol reuses the engine schema, so its version stays 1 (as 277.3). The store keeps one code path, the extension's fold copies the value, and the hand-written repository fakes keep compiling.
  - A new kind `position-cleared` and a `clearSpawnPositions` method: a case in every event switch and a member in every hand-written fake, for the same information.
- Where: `encounterEventSchema` (`packages/engine/src/encounter/events.ts`); `EncounterRepository.setSpawnPositions` (`packages/engine/src/encounter/repository.ts`); `SqliteEncounterRepository.setSpawnPositions` (`packages/store-sqlite/src/sqlite-repository.ts`); `fold` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 306.2 Undo writes a cleared spawn position back and reports the token moved back

- Decided by: maintainer (#306, 2026-10-26); recorded at the epic #280 orchestrator's plan gate, not human-approved.
- Context: 283.9 left a monster with no earlier spawn position where the move put it and reported it `kept-no-value` ("token not moved back: it had no spawn position").
- Options:
  - Chosen: `undoLastCommand` writes the null back through `setSpawnPositions` and reports the position `reverted`; the reply's line is "<Name> token moved back", and the structured entry is 311.2's `{ monster, field: "position", before: "moved", after: "moved back" }`. `kept-no-value` covers only a null group or armor class.
  - Keep 283.9: the DM drags the token back by hand.
- Where: `undoLastCommand`, `UndoChange` (`packages/engine/src/encounter/undo.ts`); `undoLine` (`packages/mcp/src/tools.ts`).
- Status: active
- Supersedes: 283.9 (its position clause; the null group and null armor class clauses stand)

## 306.3 The extension records where a token stood before its first move to a spawn position, and moves it back there when the spawn position is cleared

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the extension decides where the token goes, between the position it had before the move and a fresh default-row slot, is the maintainer's (#306, 2026-10-26).
- Context: the default-row slot exists only in the extension, and the move overwrote the token's recorded position (277.4).
- Options:
  - Chosen: the synced record gets a reserved key `previousPosition` (`PREVIOUS_POSITION_KEY`) beside `position`. `null` means the instance had no spawn position when the token was last placed (written at creation in the default row and after a move back); a point is where the token stood before the extension first moved it to a spawn position; absent is unknown (a token created at a spawn position, or before this key existed; none is adopted). A planned move of a token whose key is `null` records where the token stands, or its recorded position when it already stands at the target (a retry after the move was written but not the record); later moves keep the point. When its instance has no spawn position, a token with a recorded point moves back there, on an event or a snapshot, and its record then holds that position and `null`. Undo restores what was, including a GM placement before the move, and it works after a reload and for an undo made while the extension was offline.
  - A fresh default-row slot at the current viewport only: no persisted key, but the token lands wherever the GM is looking, and a snapshot cannot tell a cleared token from any other default-row token.
- Where: `PREVIOUS_POSITION_KEY`, `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Revisit if: a token created before this key existed is moved and undone often enough that the fallback slot (306.4) bothers the DM.
- Status: active

## 306.4 A token moved back with no previous position recorded takes a fresh slot in the default row, beside the new tokens

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (spec audit conflict with 50.7), not human-approved.
- Context: a token has no previous position when its monster was added and moved before the extension saw either (the token is created at the spawn position), or when it was created before 306.3. 50.7 builds the default row from the new tokens only.
- Options:
  - Chosen: when an `mcp` `position-changed` event cleared its spawn position, such a token gets a fresh default-row slot at the current viewport. The row holds, in encounter order, the reconcile's new tokens without a spawn position and these tokens, laid out by the same `rowPositions`. Its record then holds the slot and `previousPosition: null`. Without the event (a snapshot only), it stays where it is.
  - A row of its own centred on the viewport: keeps 50.7 as written, but overlaps the new tokens when both fall in one reconcile.
  - Leave the token where it is: the reply's "token moved back" would be wrong for it.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Revisit if: a retry after a failed reconcile moves a token to a second slot (306.7).
- Status: active
- Supersedes: 50.7 (in part: the row also holds a token moved back with no previous position recorded)

## 306.5 A token moves on the `mcp` event that set or cleared its spawn position, or when a snapshot shows it off where it belongs

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; restates 277.5 with the move back (306.3, 306.4).
- Context: 277.5 said that without a spawn position an existing token is never moved.
- Options:
  - Chosen: with a spawn position, 277.5's rule stands: an `mcp` `position-changed` event (the moves set, kept on a failed reconcile) or a recorded position that differs from the spawn position moves the token, written only when it is not already there. Without a spawn position, a token with a recorded previous position moves back to it, on any reconcile; a token with none recorded takes a fresh row slot only on an `mcp` event (306.4); a token whose record says it already sits where its instance has no spawn position (`null`) is never moved, so a move and its undo folded into one reconcile cancel out. A move back over a token that is not at its recorded position, or has none, is listed with 277.6's note.
  - Keep 277.5 as written: undo of a default-row move would not reach the table.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`); `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: a move made while offline sets the same position again (the snapshot cannot see it), as 277.5.
- Status: active
- Supersedes: 277.5

## 306.6 An unreadable `previousPosition` counts as absent

- Decided by: implementer, 2026-10-26, implementation; not human-approved.
- Context: the key's value may be neither null nor a point, written by another tool or an older build.
- Options:
  - Chosen: read it as absent (unknown), as `asPosition` reads other recorded positions: the token is moved back to a fresh row slot only on an `mcp` event, and a later move records nothing.
  - Read it as null: a later move would record a previous position over a value the extension did not write.
- Where: `previousPosition` (`packages/owlbear/src/sync-plan.ts`).
- Status: active

## 306.7 A fallback slot may change on the retry of a failed reconcile; accepted as a limitation

- Decided by: work-ticket orchestrator (the #306 session of the epic #280 run), 2026-10-26, review round 1 (overrides a reviewer blocker); not human-approved. Kept as accepted for now, with its options and revisit target corrected, by the epic #280 orchestrator, 2026-10-26, PR review; not human-approved.
- Context: the reviewer found that the fallback slot (306.4) is not stable across a retry. A reconcile that writes the move and then fails before the synced record is written plans the slot again on the retry. When the row's new tokens now exist, or the viewport moved during the backoff, the slot differs, so the token moves a second time and the move note says it had been moved on the table. Moves to a spawn position and moves back to a recorded previous position have a fixed target and are not affected.
- Options:
  - Chosen: accept it and say so in `planSync`'s doc. It needs the fallback path (a token with no previous position: created before 306.3, or a monster added and moved before the extension saw either), a write failure between the move and the record in the same reconcile, and a changed row or viewport. The cost is a second move within the default row and a misleading note.
  - Write `previousPosition: <slot>` as a pre-move marker in the same reconcile, before the move, the way `plan.replace` writes its marker before the add: a failure after the marker leaves a fixed point that the move-back rule (306.3) already handles, with no second slot and no false note. The cheapest fix; not taken in this PR.
  - Record the slot as `previousPosition` and move on the next reconcile: the sync ignores item changes caused by its own writes, so it would need to queue that reconcile itself (one `queueQuiet()` call), and the move would land one reconcile later.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Revisit if: a token is seen moving twice, or with a false move note, after an undo; then write the pre-move marker above.
- Status: active
