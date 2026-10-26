# feature: replace a token whose kind must change after a monster-type change (circle to image and back)

Issue: [#303](https://github.com/askrzypczak/ttrpg-agents/issues/303).

## 303.1 A token whose kind must change is replaced: a new token drawn as a new token of the new type, then the old one deleted

- Decided by: maintainer (ticket body, written at the epic #280 orchestrator's direction, 2026-10-26) for the replacement; the details (what is carried, the removal of the keep-own-picture fallback) are the epic #280 orchestrator's, 2026-10-26, plan gate, not human-approved.
- Context: Owlbear's item `type` is read-only, so #285's redraw kept a token's kind: a circle whose new type had art stayed a circle, and an image token whose new type had no usable art kept the old monster's picture.
- Options:
  - Chosen: the redraw draws the target look a new token of the new type gets (`config.tokenKind` with the usable art). Same kind: #285's in-place redraw. Different kind: the token is replaced by a new item carrying the old token's name, position, visibility, rotation, layer, lock and metadata as the reconcile leaves them (its planned rename, move and metadata writes folded in), at scale 1; then the old token is deleted. An image token whose type has no usable art becomes a circle (the keep-own-picture fallback is gone).
  - Keep #285's in-place redraw (285.10): a goblin changed to an owlbear keeps goblin art, and art for the new type is used only for new tokens.
- Where: `planSync`, `SyncPlan.replace` (`packages/owlbear/src/sync-plan.ts`); `apply` (`packages/owlbear/src/encounter-sync.ts`); `toItem`, `fromItem` (`packages/owlbear/src/obr-adapter.ts`).
- Supersedes: 285.10
- Status: active

## 303.2 The old token is marked with its replacement's id before the add; a replacement found half done is finished

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: a failure between the add and the delete leaves two linked tokens (the second is left alone as a duplicate), and a missing token of a placed instance reads as a GM deletion (`token-deleted`).
- Options:
  - Chosen: the old token's synced record gets `replacedBy` (`REPLACED_BY_KEY`, the replacement's item id) before the add. A planner that finds a marked token whose replacement is on the scene and linked to the same instance deletes the marked one and takes the replacement as the instance's token. A marked token whose replacement is not on the scene is the instance's token like any other, and the replacement is planned again. The instance always has a linked token, so it is never reported deleted.
  - Delete first, then add with the same id: no marker, but a failure between the two leaves no token, which reads as a GM deletion.
  - A record of pending replacements in scene metadata: a second scene-wide state to keep in step.
- Where: `REPLACED_BY_KEY`, `planSync` (`packages/owlbear/src/sync-plan.ts`); `apply` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 303.3 The replacement's item id is the old one with a generation suffix, `<base>-r<n>`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: the old id (`ttrpg-instance-<instanceId>`) is taken until the delete, which follows the add.
- Options:
  - Chosen: `ttrpg-instance-<instanceId>` becomes `ttrpg-instance-<instanceId>-r2`, then `-r3` at a later replacement; the first such id not on the scene. `instanceIdOf` reads the link from the copied metadata and `placed` holds instance ids, so both stay correct; nothing in production parses item ids.
  - A random id: the pure planner would need an id source.
  - `ttrpg-instance-<instanceId>-<monsterKey>`: reuses an id after its delete when a monster goes back and forth, which the SDK may not allow.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active

## 303.4 Every replacement is listed in the panel, after the old token is deleted; a move folded into it is listed after the add

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that a write over table state is visible to the GM is the maintainer's (#209, #280).
- Context: Owlbear deletes the GM's attachments with the old token, and the replacement overwrites the token's kind and size.
- Options:
  - Chosen: `replaceOverrideNote(name)` ("<name>'s token was replaced with a new one for its new monster type at the agent's request; any attachments on the old token were deleted with it.") for every replacement, reported right after the old token's delete (again by the retry that finishes a half-done one), as 277.10 does for moves. A move folded into the replacement keeps its move note, reported after the add. No redraw note. One reconcile gives one replacement note per instance, even when it finishes a half-done replacement and replaces the same token again (the implementer's choice, review round 1: the planner plans the note once per instance and `apply` reports each note once).
  - Only when the old token had attachments: needs the adapter to read `attachedTo` of other items.
  - Report the note after the add: a retry that finishes the delete could not tell whether it was reported.
- Where: `replaceOverrideNote`, `planSync` (`packages/owlbear/src/sync-plan.ts`); `apply`, `writeNoteKind` (`packages/owlbear/src/encounter-sync.ts`); `#overrides` (`packages/owlbear/index.html`).
- Revisit if: the GM finds a note per instance too coarse when one reconcile replaces a token twice.
- Status: active

## 303.5 A circle whose new type has no art opens the picker, as a new token of that type would

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q1), not human-approved.
- Context: before this ticket a pick could not change a circle, so only image tokens opened the picker on a redraw.
- Options:
  - Chosen: every redrawn token whose new type has no usable art lists the type in `needsArt`; a pick replaces a circle with an image token, a cancel resizes it in place. The ticket's rule is "drawn as a new token of the new type would be", and a new token of that type asks.
  - Do not ask: only a type that already has art turns a circle into an image.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active

## 303.6 The replacement keeps the old token's lock

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q2, raised by the spec audit), not human-approved.
- Context: `toItem` writes `locked`, but `fromItem` did not read it, so a locked token would come back unlocked.
- Options:
  - Chosen: `fromItem` reads `locked` and the replacement copies it. A silent unlock is a write over a table value with no note.
  - Name the lost lock in the replacement note.
  - Accept a silent unlock.
- Where: `fromItem` (`packages/owlbear/src/obr-adapter.ts`); `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active

## 303.7 A marker whose replacement is not on the scene is not cleared

- Decided by: spec audit at the plan gate, accepted by the epic #280 orchestrator, 2026-10-26, not human-approved.
- Context: a failed add leaves `replacedBy` on the old token.
- Options:
  - Chosen: leave it. That token is the instance's token like any other, and a later replacement writes the marker again.
  - Drop it from the token's next synced record: a metadata write with no consumer.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`).
- Status: active
