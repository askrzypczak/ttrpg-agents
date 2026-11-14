# feature: the extension reports the open scene and reconciles only the encounter bound to it

Issue: [#364](https://github.com/askrzypczak/ttrpg-agents/issues/364). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 364.1 The GM tab mints `com.ttrpg-agents/scene-id` once and reports the open scene with `scene-open` on start, on each ready change and after each `hello-ack`; a send that does not go out is dropped

- Decided by: maintainer, 2026-11-11 (epic #358 body: the key and the message; 357.12: players mint and send nothing) and 2026-11-13 (358.2: mint once when absent, on scene ready and on startup with a scene open, never re-mint). Minting over a stored value the schema refuses, and dropping unsent reports, by the epic #358 orchestrator, 2026-11-13, plan gate (planner's calls); not human-approved. Running the reads and mints one at a time, and a `hello-ack` with no scene ready sending null, by the implementer, 2026-11-14, implementation; not human-approved.
- Context: Owlbear gives a scene no id our store can bind (spike #359). A switch fires ready false then true; no ready event fires when the extension loads with a scene open. Only the latest open scene matters to the bridge.
- Options:
  - Chosen: a reporter module (`createOpenSceneReporter`) reads the metadata on start, on ready true and on `hello-ack`, writes a random id when none is usable, and sends `scene-open`; ready false sends null. A generation counter discards a read or mint that a ready change overtook. An unsent report is dropped; the next `hello-ack` sends the latest.
  - Queue unsent reports: a stale scene could reach the bridge after a newer one.
  - Keep a stored value the schema refuses: the bridge would refuse every report from that scene.
  - Fold the reporter into `createEncounterSync`: the sync gains a second ready subscription and the mint flow.
  - Concurrent reads: a ready change and a `hello-ack` close together could both find no id and mint twice.
- Where: `SCENE_ID_METADATA_KEY`, `sceneIdOf`, `createOpenSceneReporter` in `packages/owlbear/src/open-scene.ts`; `sceneIdSchema` and `scene-open` in `packages/protocol/src/protocol.ts`; `packages/owlbear/src/main.ts`.
- Status: active

## 364.2 `PROTOCOL_VERSION` goes to 3, so a GM tab loaded before this change is refused

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (Q1, approved as AC9); not human-approved.
- Context: The epic's rule bumped the version only when a receiver would reject the other side's message. Zod strips the new fields, so an older tab would accept the new snapshots, and its `planSync` would reconcile the current encounter into whatever scene is open, deleting a prepared scene's tokens.
- Options:
  - Chosen: bump to 3. The rule is amended: a bump is also right when an older build of the other side would accept the new messages and act unsafely on them.
  - No bump: the old tab keeps wiping prepared scenes until it is reloaded.
- Where: `PROTOCOL_VERSION` in `packages/protocol/src/protocol.ts`.
- Revisit if: a later field change is safe for an older build; 360.4's no-bump choice for #360's fields stands.
- Status: active

## 364.3 The extension reconciles only while its snapshot is for the open scene and has an encounter; a scene switch stops a reconcile before its next write

- Decided by: maintainer, 2026-11-11 (epic #358 body: reconcile only while holding the encounter bound to the open scene, otherwise touch nothing). The check points and the scene epoch by the epic #358 orchestrator, 2026-11-13, plan gate; not human-approved.
- Context: Opening a prepared scene while the tab holds another encounter would delete, re-create or move its tokens (the epic's first acceptance criterion). Owlbear rejects item calls while no scene is ready, but a reconcile can read one scene and write after the next is ready.
- Options:
  - Chosen: after every scene read in a reconcile (the first, and the one after an art step), go on only when the held encounter is non-null and the held scene id equals the scene's id; otherwise stop with no write, no `placed` write, no `token-deleted`, no error and no retry. A ready change (either value) while a reconcile runs stops it before its next write; the ready flip reconciles again. A scene read that fails is still reported and retried as before, and writes nothing (implementer, 2026-11-14; not human-approved).
  - A check at the start of a reconcile only: a switch during an art step writes into the next scene.
  - No epoch, relying on Owlbear rejecting item calls between scenes: true in Owlbear, where a switch takes 0.5 to 0.8 s, but the fake switches synchronously and the window stays open.
- Where: `createEncounterSync` and `heldScene()` in `packages/owlbear/src/encounter-sync.ts`.
- Status: active

## 364.4 Tokens record their encounter in the link value `{ instanceId, encounterId }`; a reconcile manages only tokens that record the held encounter

- Decided by: maintainer, 2026-11-11 (epic #358 body: tokens record their encounter; 357.15: old tokens are left to the GM). The link value, as the ticket names it, confirmed by the epic #358 orchestrator, 2026-11-13, plan gate; not human-approved.
- Context: A scene can hold tokens of another encounter (a duplicated scene that was re-bound later) and tokens from before the epic, which record no encounter.
- Options:
  - Chosen: `planSync`'s context names the held encounter; an item is one of its tokens only when its link records that id. Every other item is never deleted, moved, renamed, redrawn, replaced or written, and still counts as a taken id.
  - A separate item metadata key: one more key on every token.
- Where: `planSync` and `defaultSyncConfig` in `packages/owlbear/src/sync-plan.ts`.
- Status: active

## 364.5 An event of another encounter advances `seq` and settles the command it acknowledges, and nothing else; an event with no encounter is applied to the held one

- Decided by: maintainer, 2026-11-11 (ticket: fold only the held encounter's events or null ones, advance `seq` for every event). Settling the command by the epic #358 orchestrator, 2026-11-13, plan gate (audit question); not human-approved. The null rule is 360.4 and the epic's cross-epic line (Epic O's art events).
- Context: The change log is one sequence across encounters, so skipping another encounter's events must not look like a gap. An edit sent just before a scene switch is acknowledged by an event of the encounter the tab no longer holds.
- Options:
  - Chosen: the duplicate and gap checks run on every event; another encounter's event advances `seq` and settles its outbox command by command id; no fold, bookkeeping, report or reconcile.
  - Advance `seq` only: the command stays pending until the next reconnect.
- Where: the event handling in `packages/owlbear/src/encounter-sync.ts`.
- Status: active

## 364.6 A snapshot is for the open scene and carries its id and the encounter's name; with no scene open it carries the current encounter and a null scene

- Decided by: maintainer, 2026-11-11 (ticket: the snapshot names its scene and the encounter's name; `encounterId` is null when the open scene has no encounter). The no-scene case and the required fields by the epic #358 orchestrator, 2026-11-13, plan gate (planner's call); not human-approved.
- Context: The bridge picks the snapshot's encounter; the extension compares the snapshot's scene with the open one.
- Options:
  - Chosen: `sceneId` and `encounterName`, both required and nullable. An open scene with no encounter gives a null encounter and no instances, even while another encounter is current. With no scene open the current encounter is sent with a null scene, which no open scene matches.
  - A null encounter with no scene open: breaks the existing snapshot tests for no gain, since the extension never reconciles a null-scene snapshot.
  - Optional fields: a tab of this build would reconcile an older bridge's snapshot, which names no scene.
- Where: `snapshotMessage` in `packages/bridge/src/encounter-bridge.ts`; `encounterSnapshotPayload` in `packages/protocol/src/protocol.ts`.
- Status: active

## 364.7 One snapshot source remembers the last snapshot's scene, encounter and name; the change-log poll sends a fresh snapshot when they differ

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (planner's call); not human-approved.
- Context: A binding, a rename or another process opening a scene writes no change-log event, yet the tab must hear of it (the MCP server creating an encounter for the open scene).
- Options:
  - Chosen: `createSnapshotSource` builds every snapshot (after `hello-ack`, after `scene-open`, after an unreadable row and the poll's) and remembers its scope; each poll tick asks `changed()`, two store reads.
  - Compare the scope tick to tick: every scene switch gets a second snapshot after the `scene-open` handler's, and a snapshot on the same connection drops the sent edits the tab holds.
  - Log bindings and renames in the change log: engine and store changes in the files of #363 and #365.
- Where: `createSnapshotSource` and `broadcastLogEvents`'s `scopeChanged` in `packages/bridge/src/encounter-bridge.ts`; `packages/bridge/src/cli.ts`.
- Status: active

## 364.8 The bridge records no open scene when it starts, when the active client disconnects and when it closes; a displaced client's disconnect changes nothing

- Decided by: maintainer, 2026-11-11 (ticket: null on start and on the active client's disconnect; 357.20: with no tab open a command goes to the named or the current encounter). The bridge closing by the epic #358 orchestrator, 2026-11-13, plan gate (A10, approved as AC10); not human-approved.
- Context: The MCP server keeps running in Claude sessions after `bridge:stop`; an open scene left in the store would keep steering its commands to that scene's encounter.
- Options:
  - Chosen: `cli.ts` calls `openScene(null)` once the server listens (364.10); the server calls it when the active socket closes or errors and in `close()` before it terminates the sockets.
  - Keep the last open scene after the bridge stops: commands with no tab open act on the last scene's encounter.
- Where: `BridgeServerOptions.openScene` and `close()` in `packages/bridge/src/server.ts`; `packages/bridge/src/cli.ts`.
- Status: active

## 364.9 A failing `openScene` is a non-fatal `scene-open-failed` error, and no snapshot follows

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (planner's call); not human-approved.
- Context: The store write can fail (a locked or broken database). The tab touches nothing while it has no snapshot for its scene.
- Options:
  - Chosen: an `error` with code `scene-open-failed`, `fatal: false`, echoing the request id; the tab tries again on the next ready change or connection.
  - A fatal error: the GM tab would stop reconnecting over a store error.
  - Ignore the failure: nothing would tell it apart in the logs.
- Where: the `scene-open` handler in `packages/bridge/src/server.ts`.
- Status: active

## 364.10 The bridge clears the open scene once its port is listening, not before the server starts

- Decided by: implementer, 2026-11-14, implementation; not human-approved. The plan had `cli.ts` call `openScene(null)` before `startBridgeServer`.
- Context: A second bridge started while one runs fails on the taken port. Clearing first would wipe the running bridge's open scene, and its GM tab would not report the scene again until the next ready change or connection.
- Options:
  - Chosen: `cli.ts` calls `openScene(encounters, null)` right after `startBridgeServer` resolves, before the poll starts and before any client message can be handled.
  - Before the server starts (the plan's wording): the failing bridge clears the running one's scene.
- Where: `packages/bridge/src/cli.ts`.
- Status: active

## 364.11 A reconcile reports no `token-deleted` for a placed instance whose only token records another encounter or none, and a scene change after its last write abandons its reports

- Decided by: implementer, 2026-11-14, implementation; not human-approved. It applies 364.3 and 364.4 (fail closed).
- Context: `token-deleted` removes the instance from the store. A token the reconcile does not manage still stands on the scene, and a reconcile overtaken by a scene switch no longer knows which scene its deletions were seen in.
- Options:
  - Chosen: neither case sends `token-deleted`; the instance stays in the store and the next reconcile for the open scene decides again.
  - Report them: a token the GM never deleted, or a deletion seen in another scene, would remove a monster from the encounter.
- Where: `planSync` in `packages/owlbear/src/sync-plan.ts`; the reconcile in `packages/owlbear/src/encounter-sync.ts`.
- Status: active
