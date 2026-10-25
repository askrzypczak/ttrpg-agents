# feature: store the bytes of token art that has none stored

Issue: [#250](https://github.com/askrzypczak/ttrpg-agents/issues/250).

## 250.1 Art without stored bytes is checked and stored on every snapshot, for every such row at once, outside the reconcile chain

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: Art picked before #219, or whose upload failed, has a url and no hash, so #220's republish has no bytes for it once its Owlbear asset is gone. The ticket left open whether the bytes are stored on connect for every such row or before the first tokens of the type, like #220's liveness check (220.5).
- Options:
  - Chosen: on every `encounter-snapshot` (connect, reconnect, gap), every art row with a url and no hash whose monster key is not yet in the session's `checked` set gets a liveness check and, when alive, the fetch and upload of a pick (`storePicked`), all started together like picks and outside the reconcile chain. The shared `checked` set gives one attempt per monster key per session: a pick this session is that type's attempt, and a type handled on connect is not checked again before its tokens. It is the only option that reaches rows of types that get no new tokens this session, the legacy set this ticket exists for; that set is bounded and shrinks as backfills succeed, and the browser's per-host connection limit throttles a burst. 219.4's rule for the panel text (a later failure replaces it) stays.
  - The same trigger, one row at a time: no burst at connect, for one more loop; failures would still replace each other.
  - Before the first tokens of the type, like #220's check: requests only for types in use, but rows of types with no new tokens this session stay without bytes, and are lost if their asset is deleted meanwhile.
- Where: `backfillImage` and the `encounter-snapshot` branch of `handleMessage` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: a library of hundreds of link-only rows makes the connect burst noticeable, or several failures at once need to be listed rather than replaced.
- Status: active

## 250.2 A liveness check that cannot tell leaves art without stored bytes as it is, silently, and spends the session's attempt

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The check (220.2) answers alive, dead, or cannot tell (a network error or a status other than 2xx or 4xx). The ticket says a failed fetch or upload shows in the panel and a dead url leaves the row unchanged; it does not say what a check that cannot tell does.
- Options:
  - Chosen: silent, like a dead url: nothing is fetched or uploaded, the art stays as stored and the panel shows nothing; the type's attempt for the session is spent. Consistent with 220.2, where a check that cannot tell keeps the stored art.
  - Report it through `onArtStoreFailed`: the url may well be fine, and a message would be noise on a flaky network.
- Where: `backfillImage` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
