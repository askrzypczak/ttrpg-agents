# bug: a monster restored while the extension was disconnected, after the GM deleted its token, is removed again

Issue: [#298](https://github.com/askrzypczak/ttrpg-agents/issues/298). Part of Epic K ([#326](https://github.com/askrzypczak/ttrpg-agents/issues/326)). Its store, port, bridge and wire part is [#328](https://github.com/askrzypczak/ttrpg-agents/issues/328).

## 298.1 The placed record carries the seq it is current as of, and an instance restored after that seq is planned as new

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved. The maintainer widened the ticket to a closed or reloaded tab (epic #326 body, 2026-10-31).
- Context: When a reconnect or a reload replaces the `removed` event with a snapshot and the monster was restored meanwhile, the snapshot showed it back with nothing about its removal, so the extension could not tell a deletion that reached the store from one lost in flight and reported it again (291.2). The outbox and every in-memory set are gone after a reload; `placed` (scene metadata) survives.
- Options:
  - Chosen: candidate 1 of the ticket with a persisted seq. #328's snapshot carries each restored instance's restore seq (`restoreSeqs`, 328.1). The extension keeps the seq its desired encounter is current as of and each instance's last restore seq (the snapshot's `restoreSeqs`, then each applied `added` event), stores the seq beside `placed`, and plans with the record minus the ids restored after that seq. A deletion lost in flight has no restore, so it is still reported.
  - Candidate 2, resend a stale `token-deleted` with its original id and let the bridge answer "already applied" by command id: does not survive a reload unless the pending deletions are persisted too, and needs a change-log lookup by command id before every GM deletion.
  - `hello` carries a seq and the bridge answers the ids restored since: `hello` goes out before the scene is ready after a reload, and one seq per connection does not fit per-scene records.
- Where: `createEncounterSync` (`handleMessage`, `reconcile`, `readScene`, `apply`) and `PLACED_SEQ_METADATA_KEY` in `packages/owlbear/src/encounter-sync.ts`; `docs/architecture.md` ("Deleted tokens stay deleted").
- Revisit if: the change log gets pruned, or a restore path appears that does not record a restore seq (see 328.1).
- Status: active
- Supersedes: 291.2

## 298.2 The seq has its own scene metadata key, written with `placed` in one call and only when the record needs it

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved.
- Context: The seq must survive a reload and follow each scene's own record, without one more scene write per event and without breaking an older extension that reads `placed`.
- Options:
  - Chosen: `com.ttrpg-agents/placed-seq`, a non-negative integer, written in the same `setSceneMetadata` call as `com.ttrpg-agents/placed` in three cases: the ids change, the stored record has ids but no seq, or an id was dropped for a restore after the stored seq. The value is the newest change the applied encounter reflects: the larger of its seq and the restore seqs of its instances, since a snapshot reads `restoreSeqs` after its `seq` (328.2). A missing or malformed value reads as none. An id dropped for a restore counts even when it also left the encounter, so a removal and a restore folded into one reconcile record the restore's seq in that reconcile (review round 1). A record with neither ids nor a seq (a fresh scene) is not written by itself; it gets its seq with its first ids (the implementer).
  - Write it on every reconcile: one more scene write per event, and the existing "no write calls when the scene already matches" rule would break.
  - Reshape `placed` into `{ ids, seq }`: an older extension would read it as no record and repopulate the scene.
- Where: `readScene` and `apply` in `packages/owlbear/src/encounter-sync.ts`; `docs/architecture.md` ("Who owns what"); `packages/owlbear/README.md` ("Deletion and `placed`").
- Status: active

## 298.3 The store, port, bridge and wire part is #328

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved.
- Context: The combined plan touched five packages, and CLAUDE.md splits such a plan into a prerequisite ticket and a feature ticket.
- Options:
  - Chosen: #328 carries the column, the port method, the bridge payload and the protocol field (328.3); this ticket keeps the extension side, its docs and this log, and was blocked by #328.
  - One PR over five packages: against the rule.
- Where: #328; this ticket.
- Status: active

## 298.4 The "restored after the placed record" comparison stays in the extension's `apply`

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved.
- Context: CLAUDE.md puts in the engine any number or verdict the agent reports. This comparison never reaches the agent, and `planSync` and 291.1's `left` already decide deletions in the extension, whose own bookkeeping `placed` is ("Who owns what").
- Options:
  - Chosen: `apply` leaves the restored ids out of the record it plans with, next to `left`.
  - A pure engine function `restoredAfter(restoreSeqs, placedSeq): Set<string>`, imported by owlbear over its existing edge: cheap (one export and a unit test), so the maintainer can still ask for it.
- Where: `apply` in `packages/owlbear/src/encounter-sync.ts`.
- Status: active

## 298.5 A token created for a restore learned from a snapshot gets no panel note

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved.
- Context: The rule that a write over a table value not caused by a known MCP change gets a visible panel note (maintainer, 2026-10-24, #209). Here the new token answers a known MCP change, the restore.
- Options:
  - Chosen: no note, as for a restore folded with its removal (291.1).
  - A note per such token: noise for a change the agent already reported to the GM.
- Where: `apply` in `packages/owlbear/src/encounter-sync.ts`.
- Status: active

## 298.6 A placed record without a seq keeps today's behaviour for one reconcile, then gets a seq

- Decided by: epic #326 orchestrator, 2026-10-31 (plan gate), not human-approved.
- Context: Scenes synced by an older extension hold `placed` with no seq. Their restores cannot be ordered against the record.
- Options:
  - Chosen: no seq-based drop for that reconcile, so a placed instance without a token is reported deleted as before; the record is then written with a seq.
  - Treat a missing seq as 0: every instance with a restore seq would get a new token on the first reconcile, including one whose token the GM deleted after its restore.
- Where: `apply` in `packages/owlbear/src/encounter-sync.ts`.
- Status: active
