# feature: `table_status` names the open scene's encounter and judges sync against it

Issue: [#367](https://github.com/askrzypczak/ttrpg-agents/issues/367). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 367.1 `table_status` reads the open scene's binding through the directory and resolves no encounter

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (AC1 reworded); not human-approved. It applies 361.5 (a tool that never reads `repo` resolves no encounter).
- Context: Before this ticket `table_status` reached its encounter through the resolution rule's read form, which fails "This scene has no encounter yet." in an open scene with no encounter and creates "Encounter 1" on an empty store. A status query should report the table, not refuse or write.
- Options:
  - Chosen: `getTableStatus(directory, table)` reads `getOpenScene()` and, for a bound encounter, `repositoryFor(id).listInstances()`; it never resolves or creates an encounter. In an open scene with no encounter the reply gives a verdict and "This scene has no encounter yet."; with no scene open it says "No scene is open." with an encounter count of 0.
  - Keep the read form: the tool fails in exactly the scene the DM most needs it to describe, and creates an encounter on an empty store.
  - Fall back to the current encounter when no scene is open: the table shows no encounter then (364.6), so a count against it would be compared with nothing on the table.
- Where: `getTableStatus` in `packages/engine/src/table/status.ts`; `table_status` in `packages/mcp/src/tools.ts`.
- Status: active

## 367.2 `tokenCount` is the held encounter's tokens; our other tokens are counted apart and never make the table out of sync

- Decided by: maintainer, 2026-11-11 (ticket: unmanaged tokens are reported and do not make it out of sync; 357.15: old tokens are left to the GM). The split of the count, by the epic #358 orchestrator, 2026-11-14, plan gate (planner's call 1); not human-approved.
- Context: A scene can hold our tokens of another encounter (a duplicated scene) and tokens from before the epic, which record no encounter. Today `tokenCount` counts every token carrying our link.
- Options:
  - Chosen: the GM tab counts our tokens whose link records the encounter it holds for the open scene as `tokenCount` and the rest of ours as `unmanagedTokenCount`, using the planner's own link reader (`linkedEncounterOf`, 364.4). The engine compares counts as before.
  - `tokenCount` stays every token of ours and the engine subtracts: `TableStatus` gains a managed count for the reply, and an older tab's count would be read two ways.
- Where: `handleQuery` in `packages/owlbear/src/queries.ts`; `linkedEncounterOf` in `packages/owlbear/src/sync-plan.ts`; `sceneStatusSchema` in `packages/protocol/src/protocol.ts`.
- Status: active

## 367.3 In sync also needs the GM tab to hold the open scene's encounter for that scene; with no scene open a current tab is never in sync

- Decided by: maintainer, 2026-11-11 (ticket: in sync requires the held encounter to be the open scene's). Also comparing the scene id, and no sync with no scene open, by the epic #358 orchestrator, 2026-11-14, plan gate (planner's calls 2 and 3); not human-approved.
- Context: In an open scene with no encounter both the held and the bound encounter are null, so comparing encounters alone would read in sync while the tab is still on another scene.
- Options:
  - Chosen: `holdsOpenScene` is true exactly when a scene is open in the store, the tab's scene id is its id, and the tab's held encounter is its bound encounter (null for a scene with none). `inSync` needs it not to be false, besides today's checks. The reply adds "; the Owlbear tab has not caught up yet" when it is false.
  - Compare the held encounter only: false in sync in an unbound scene while the tab lags.
- Where: `getTableStatus` in `packages/engine/src/table/status.ts`.
- Status: active

## 367.4 The new `scene-status` fields stay optional; an older tab gets today's verdict and the reply says the tab's encounter is unknown

- Decided by: maintainer, 2026-11-11 (ticket: fields optional, like `roomId`) and 2026-11-06 (344.1: the "unknown: reload the Owlbear tab" wording). Keeping them optional against the audit's question by the epic #358 orchestrator, 2026-11-14, plan gate; not human-approved.
- Context: 364.2 refuses every GM tab older than protocol 3, and #364 and #367 reach main in one epic PR, so no protocol-3 tab without the fields should exist on main.
- Options:
  - Chosen: optional fields; with no scene id or held encounter reported, `holdsOpenScene` is undefined, the verdict comes from today's checks, and the reply names the encounter from the store with "(the tab's encounter unknown: reload the Owlbear tab)". An answer with no unmanaged token count reads as none: no line and no key (implementer, 2026-11-14, implementation; not human-approved).
  - Required fields: removes the optional state from four layers, but goes against the ticket's wording.
- Where: `sceneStatusSchema` in `packages/protocol/src/protocol.ts`; `TableSceneStatus` in `packages/engine/src/table/port.ts`; `getTableStatus`; `table_status`.
- Revisit if: the protocol is bumped again, which would make the optional branch dead.
- Status: active

## 367.5 `table_status`'s structured content names the encounter under `encounter` and adds `unmanagedTokenCount` only when there are some

- Decided by: maintainer, 2026-11-13 (358.1: the structured content always carries the encounter's name) and 2026-11-06 (344.4: a key per number the line states). The key name `encounter` (a string or null) by the epic #358 orchestrator, 2026-11-14, plan gate, as a convention shared with #365; not human-approved.
- Context: The agent reads the structured content; #365 names the encounter in every other tool's structured content.
- Options:
  - Chosen: `encounter` is the open scene's encounter name, or null when the scene has none or no scene is open; `unmanagedTokenCount` appears only when it is above 0, as `waitingOnGm` does; no key for `holdsOpenScene` (the text gives the reason, `inSync` the verdict).
  - Text only: the agent parses prose for the name.
- Where: `table_status` in `packages/mcp/src/tools.ts`.
- Status: active

## 367.6 The GM tab reports no instance applied while it holds no encounter for the open scene; the window before a bound scene's reconcile ends is left open

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (planner's call 6; the audit cut the reset of the applied count, proposed addition A5); not human-approved.
- Context: `appliedInstanceCount` keeps the previous scene's count after a switch until the next reconcile (#364 note).
- Options:
  - Chosen: `scene-status` reports 0 applied while `heldEncounterId` is null. Between a bound scene's snapshot and the end of its reconcile it still reports the previous count; the reconcile then sets the right value, and a wrong "in sync" in that window needs the counts to be equal by chance.
  - Reset the count in the sync on each snapshot for another scene or encounter (A5): edits the reconcile code #364 guarded, for a window that closes on its own.
- Where: `handleQuery` in `packages/owlbear/src/queries.ts`.
- Revisit if: a DM sees "in sync" before a scene's reconcile ends.
- Status: active
