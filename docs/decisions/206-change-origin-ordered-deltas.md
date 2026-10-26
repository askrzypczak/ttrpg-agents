# Epic G: change origin and ordered deltas for table sync

Issue: [#206](https://github.com/askrzypczak/ttrpg-agents/issues/206). Recorded retroactively on 2026-10-25 (#236).

## 206.1 Every encounter change carries its origin, and consumers apply an ordered, origin-tagged change log; no formal CQRS split

- Decided by: maintainer, 2026-10-24, recorded retroactively from #206 (reviewed with the maintainer; built by #208, #128, #224 and #209).
- Context: Two actors change the encounter: the agent through the MCP tools and the GM at the Owlbear table, whose edits are written back since #162. The store recorded neither who made a change nor which request, so the extension inferred what to write with a three-way merge in `planSync`, plus #204's interim `cause` tag and memory of sent edits.
- Options:
  - Chosen: every repository mutation takes a `ChangeOrigin` (`mcp` or `table`, plus a command id). The store appends each change with its origin to an ordered log; the bridge polls it and broadcasts `encounter-event`s with `seq`, sending a snapshot only on connect, on a gap or in place of an unreadable row; the extension applies events in `seq` order by origin, treats the events of its own commands as acknowledgements and queues commands while the socket is down.
  - A formal CQRS split (separate command and query models): "Formal CQRS adds nothing by itself" (#206); the origin and the ordered log are the two properties the sync needs.
  - Keep snapshots with #204's `cause` tag and sent-edit memory: the interim; it left a window of about 250 ms that could swallow an MCP change, and #209 retired it once every event carried an origin.
  - Push changes directly between the processes (#128 chose a change log in the store).
  - Diff snapshots in the bridge (#128 chose a change log in the store).
  - Snapshots only, dropping the extension's event handling (#201): it "goes the other way" (#206).
  - Postpone the log until a feature needs per-change deltas: the maintainer's call on #128 on 2026-10-24, reversed the same day by this epic.
- Where: `ChangeOrigin` and `changeOriginSchema` (`packages/engine/src/encounter/origin.ts`); `EncounterLog` (`packages/engine/src/encounter/log.ts`); `encounterEventSchema` (`packages/engine/src/encounter/events.ts`); `defineTool`'s `origin` (`packages/mcp/src/tools.ts`; `mcpOrigin` until #283); the `encounter_events` table (`packages/store-sqlite/src/migrations.ts`) and `SqliteEncounterLog` (`packages/store-sqlite/src/sqlite-log.ts`); `broadcastLogEvents` and `snapshotMessage` (`packages/bridge/src/encounter-bridge.ts`); `encounterEventPayload` and `encounterSnapshotPayload` (`packages/protocol/src/protocol.ts`); `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `createOutbox` (`packages/owlbear/src/outbox.ts`); `docs/architecture.md` (Change origin, Who owns what).
- Revisit if: reconnect snapshots or the size of the log become costly.
- Status: active

## 206.2 A snapshot writes the store's value over a value kept on the token, and the panel lists each such override until the DM dismisses it

- Decided by: maintainer, 2026-10-24, recorded retroactively from #209 (in chat at #209's plan gate; PR #232).
- Context: Under 206.1 the answer to a table edit never writes the field back, so a value the store clamped or refused stays on the token. A snapshot has no origin, so it cannot tell an MCP change made meanwhile from such a kept value. Other options offered in chat at the plan gate are not recorded.
- Options:
  - Chosen (option (a) in #209): the baseline records the sent value, and the next snapshot pushes the store's value over a kept clamp or refusal; nothing is persisted. The maintainer accepted that this bends "table wins" on condition that each override is listed in the extension's panel (instance, field, the table's value and the store's) until the DM dismisses it, so the DM can audit it.
  - Persist a record of kept values so a snapshot leaves them alone: named in the #209 plan and cut by its audit; it would add a new persisted format.
  - A snapshot keeps the token's value over the store's (reconstructed): an MCP change made while the extension was disconnected would never reach the table, since a snapshot cannot tell it from a kept clamp.
- Where: `SyncPlan.overrides` and `planSync` (`packages/owlbear/src/sync-plan.ts`); `onSnapshotOverride` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `PanelInput.overrides` and `PanelView.overrides` (`packages/owlbear/src/panel-state.ts`); `#overrides-list` and `#dismiss-overrides` (`packages/owlbear/index.html`); `docs/architecture.md` (Change origin).
- Revisit if: the DM finds the override list noisy or misses overrides, or snapshots become frequent enough (reconnects, unreadable rows) that kept values are overridden often.
- Status: active
