# bug: a reconcile that waits on a GM dialog writes from scene items read before the wait

Issue: [#252](https://github.com/askrzypczak/ttrpg-agents/issues/252).

## 252.1 A reconcile reads the scene items and the `placed` record again after any art step, and once otherwise

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: `apply` read the scene once, then waited on the GM (the fresh picker since #219, the republish since #220, with no timeout) and planned every write from that read, so a key written whole (Stat Bubbles) could put back a value the GM changed during the wait. A scene switch during the wait was worse: the old scene's `placed` record was written onto the new scene, and the next reconcile there sent `token-deleted` for instances placed only on the old scene, which removes them from the store. The spec audit proposed to cut a test for the scene switch; the orchestrator kept it (AC4), since the same re-read closes a data-loss path and the test is cheap.
- Options:
  - Chosen: re-read after any art step: the fresh picker opened (pick or cancel), or a stored-art check ran (liveness check, republish, or first publish of art without a url). `isImageAlive` is a fetch with no timeout, so its wait is unbounded too; the rule is one flag, and costs at most one extra read per type per session.
  - Re-read only after the picker or Owlbear's upload dialog opened: the same code size, but a slow liveness check would still plan from the earlier read.
  - Always re-read: one extra read on every reconcile, and the ticket asks that a reconcile with no wait read once.
- Where: `apply` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); tests in `packages/owlbear/src/encounter-sync-art-wait.test.ts`.
- Revisit if: a type that first gets tokens only in the fresh plan (possible only after a scene switch during a wait) should be asked about or checked in the same reconcile. The art steps act on the first plan, so today such a type gets circles (no usable art) or its stored art unchecked (a dead url draws a broken image, and existing tokens are never re-skinned), with no pick and no check.
- Status: active

## 252.2 The viewport centre is read once, before the art steps

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: New tokens are placed in a row around the viewport centre. The ticket names the scene items and the `placed` record for the re-read.
- Options:
  - Chosen: read the viewport centre once, at the start of `apply`, as before.
  - Read it again with the items: new tokens land where the GM looks after the wait, but it changes placement with nothing to test it.
- Where: `apply` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: tokens placed after a long wait land off the GM's view, or a scene switch during a wait leaves them at the old scene's centre.
- Status: active
