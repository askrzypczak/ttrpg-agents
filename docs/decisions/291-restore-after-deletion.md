# bug: a monster restored right after the GM deleted its token is removed again

Issue: [#291](https://github.com/askrzypczak/ttrpg-agents/issues/291). Part of Epic J ([#280](https://github.com/askrzypczak/ttrpg-agents/issues/280)).

## 291.1 Ids the extension sees leave the encounter are dropped from `placed` before the next plan, through a per-reconcile `left` set

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate; the ticket's Proposed change, with the standing decisions that the fix is extension-only and copies the `moves` pattern of #277), not human-approved.
- Context: The extension kept an id that left the encounter in `placed` until it wrote the record after a reconcile. When the GM deleted a token and the store's `removed` answer folded into one reconcile with a restore's `added` event, the restored id was wanted, placed and tokenless, so it was reported deleted again and the store removed it after the agent replied "Restored".
- Options:
  - Chosen: a `removed` event of either origin adds its id, and a `cleared` event adds every id in the encounter, to a set `left`, recorded before the fold. `reconcile` takes it with `facts` and `moves` and restores it on failure; `apply` plans with the placed record minus the taken ids, on both reads, and compares the record it writes with the stored one. An id that came back without a token gets a new one; one that kept its token keeps it.
  - Prune the scene's placed record when the event is folded: an async scene write outside the reconcile chain, which can race `apply`'s own write of the record.
  - Pass the ids into `planSync`: a wider planner interface for the same effect, and the planner would learn about events.
  - Mark restores in the protocol (an `added` event that says it is a restore): an engine and protocol change, outside the extension-only scope.
- Where: `createEncounterSync` (`handleMessage`, `reconcile`, `restore`, `apply`) in `packages/owlbear/src/encounter-sync.ts`; `docs/architecture.md` ("Deleted tokens stay deleted").
- Revisit if: a new event removes instances from the encounter without being a `removed` or `cleared` event.
- Status: active
- Supersedes: 281.5

## 291.2 A removal the extension only learns from a snapshot is not covered; filed as #298

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate), not human-approved.
- Context: When a reconnect (or a `seq` gap) replaces the `removed` event with a snapshot, and the monster was restored meanwhile, the snapshot shows it back with nothing about its removal. The outbox forgets the stale `token-deleted` at that snapshot, and the extension cannot tell a deletion that reached the store from one lost in flight, so it reports the deletion again.
- Options:
  - Chosen: record it as a known limitation and file #298, which needs a protocol change (a restore `seq` in the snapshot, or `token-deleted` made idempotent by command id).
  - Fix it here: a protocol and bridge change, outside the extension-only scope of this ticket.
  - Accept it with no ticket: leaves a silent removal unrecorded.
- Where: `createEncounterSync` in `packages/owlbear/src/encounter-sync.ts`; `createOutbox` in `packages/owlbear/src/outbox.ts`; `docs/architecture.md` ("Deleted tokens stay deleted"); #298.
- Revisit if: #298 lands, or a GM hits the race.
- Status: superseded by 298.1

## 291.3 AC4: a clear and a restore folded into one reconcile get their own acceptance criterion

- Decided by: epic #280 orchestrator, 2026-10-26 (plan gate, proposed by the spec audit), not human-approved.
- Context: The ticket's Proposed change covers a `cleared` event, but no acceptance criterion checked it. #282's `restore_encounter` emits `added` for cleared ids, so a GM-deleted token in a cleared and restored encounter hits the same race.
- Options:
  - Chosen: add AC4 (a `cleared` event and an `added` event for the same ids folded into one reconcile create their tokens and send no `token-deleted`) with its own unit test.
  - Handle `removed` only and record the clear path as a known limitation: #282's restore could hit the same bug.
- Where: `packages/owlbear/src/encounter-sync-restore.test.ts`.
- Status: active
