# chore: token art leftovers from #310: liveness check timeout, monster names in failure texts, a wasted check after a first publish

[#317](https://github.com/askrzypczak/ttrpg-agents/issues/317)

## 317.1 The liveness check is bounded in the adapter: its fetch aborts after 5 s, and the abort counts as "cannot tell"

- Decided by: work-ticket orchestrator, 2026-10-30, plan gate; the plan was approved by the maintainer, who was not asked about this choice separately.
- Context: A reconcile about to draw a type waits for its pending check (310.2), so a fetch that never settles stalls the sync chain. Both callers already read any rejection as "cannot tell" (220.2).
- Options:
  - Chosen: `AbortSignal.timeout(IMAGE_ALIVE_TIMEOUT_MS)` on the fetch in `isImageAlive`, 5000 ms. The sync does not change and the fetch is cancelled. `createObrAdapter` has no unit tests, so one e2e test waits out the real timeout, about 5 s of the e2e job.
  - Race the check against the injected `Timers` in `encounter-sync.ts`: a unit test could drive it with no wait, but it adds logic to the sync and leaves the fetch running.
  - A longer bound, such as 30 s: fewer false timeouts on a slow connection, but the GM stares at a stalled sync for that long. A false timeout only keeps the stored art for the session, as any network error does.
- Where: `packages/owlbear/src/obr-adapter.ts` (`isImageAlive`, `IMAGE_ALIVE_TIMEOUT_MS`), `packages/owlbear/e2e/token-art.e2e.ts`.
- Revisit if: #289 removes the liveness check, or GMs on slow connections see dead art kept after a false timeout.
- Status: active
