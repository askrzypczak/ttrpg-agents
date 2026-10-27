# bug: restore and token creation block on unlabelled Owlbear art dialogs, and the agent cannot see the wait

Issue: [#310](https://github.com/askrzypczak/ttrpg-agents/issues/310).

## 310.1 The GM starts the re-upload of gone or unpublished art from a panel list; no upload dialog opens by itself and nothing waits on a panel button

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q1), not human-approved; that cancelling Owlbear's upload dialog must end the wait and the panel button no longer blocks the sync is the maintainer's (#310 body, 2026-10-26).
- Context: `OBR.assets.uploadImages` resolves when Owlbear's folder dialog opens and gives no signal when the GM cancels it (220.1), so the reconcile that waited on the "Pick the uploaded image" button after the upload could wait forever, with the table at 0 tokens.
- Options:
  - Chosen: the reconcile never uploads. A type whose stored art is gone (or has no url, 310.3) is listed in the panel, one row per type ("Wolf (1 of 2)"), with "Re-upload" (loads the stored bytes from the bridge and uploads them under the hash-derived name, 220.7) and, once uploaded, "Pick the uploaded image" (the picker with that name as its search). Each button runs one dialog; nothing waits on either. The list is AC5's list, shown prominently while any type is listed; the panel opens itself when the list gains a type; `table_status` tells the DM what to click.
  - The extension opens each listed type's upload dialog by itself right after the circles are placed, one type at a time, with Pick and Skip in the panel: closer to the old flow, but a cancelled folder dialog still leaves the walk waiting on a Skip click, and it needs a walk state machine.
  - Keep the blocking wait with an extra "Use a circle" button: cancelling Owlbear's dialog would still leave the sync waiting on a panel click, which the ticket rules out.
- Where: `reuploadArt`, `pickUploadedArt`, `onReuploadsChange` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `PanelView.reuploads` (`packages/owlbear/src/panel-state.ts`); `#reupload` (`packages/owlbear/index.html`, `packages/owlbear/src/main.ts`).
- Revisit if: the maintainer wants an automatic walk of the list layered on top (this trades the old automatic dialogs for one click per type), or #289's public image bucket removes the upload step.
- Status: active
- Supersedes: 220.1

## 310.2 The liveness of stored art is checked on each snapshot, once per type per session, for every art row with a hash and a url; a reconcile awaits a pending check of a type it is about to draw

- Decided by: maintainer (#310 body, 2026-10-26) for the check on connect with no dialog; the details are the epic #280 orchestrator's, 2026-10-26, plan gate, not human-approved.
- Context: the check ran only when a type first got tokens, so a restore found every dead asset at once, mid-restore.
- Options:
  - Chosen: on a snapshot, every art row with a hash and a url, not picked this session, gets one revalidating check per session (220.2's rule for alive, gone and cannot tell), outside the reconcile chain, like the backfill of art without a hash (250.1). A gone url lists the type (310.1), whether or not it has instances. A reconcile about to create or redraw tokens of a type whose check is still pending awaits it, and that counts as an art step (252.1: the scene is read again).
  - Check only the types of the encounter's instances: after a clear there are none, so a restore would still find dead art late.
  - Draw with the stored url while the check is pending: a dead url draws a broken image until the re-upload.
- Where: the liveness map and the snapshot handler in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
- Supersedes: 220.5

## 310.3 Art without a url lists its type for upload when the encounter has an instance of it; its tokens are circles until the GM uploads

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: art without a url (bytes only, for example from the library import) was published through the blocking republish when its type first got tokens (223.4).
- Options:
  - Chosen: the same list and buttons as gone art (310.1), limited to types the encounter has, so a library import of many types does not fill the panel. The extension still never draws it or opens a fresh picker for its type (223.4's other rules stand).
  - List every art row without a url on connect: one row per imported type, most of them unused.
- Where: the re-upload list in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
- Supersedes: 223.4

## 310.4 Bytes the bridge cannot serve, a failed upload, or a cancelled, failed or invalid pick of the uploaded image keep the type listed

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: 220.3 made the type circles for the session after bytes could not be loaded; with GM-started re-uploads a retry costs nothing.
- Options:
  - Chosen: the type stays listed and its tokens stay circles; the GM can press again. Bytes that cannot be loaded are still reported through `onArtRepublishFailed` ("Could not republish the token art for <monsterKey>: <reason>", in `#sync-error` until reload), and so is a failed Owlbear upload, which was silent before (the implementer's choice, following the orchestrator's brief: with a GM-started upload, a silent failure would leave the button looking dead).
  - Take the type off the list for the session: the GM could not retry without a reload.
- Where: `reuploadArt`, `pickUploadedArt` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
- Supersedes: 220.3

## 310.5 Picking the uploaded image redraws the type's existing tokens with it, each listed under the overrides

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q2, approved against the spec audit's cut), not human-approved; "Art chosen later replaces the circle" is the maintainer's (#310 body); a visible note for a write over a table value not caused by an MCP change is the maintainer's (#209, 2026-10-24).
- Context: with circle first, a re-upload after a restore always comes after the tokens exist; without a redraw it would change nothing on the table this session.
- Options:
  - Chosen: the pick adds the type's instances to a `reskins` set; the next reconcile redraws them as a new token of their type would be drawn (#303's path): a circle is replaced by an image token, an image token is redrawn in place at scale 1. Each replacement, and each in-place redraw over a token whose art or size the table had changed (or with no recorded look), is listed under `#overrides` with re-skin wording (`reskinReplaceNote`, `reskinOverrideNote`), also when a failed reconcile's retry finishes a half-done replacement (review round 1). A re-skin applies only while the type has usable art, and an instance whose monster type also changed gets the monster-change notes (the implementer's choice, pinned in review round 1).
  - No redraw: the art applies to tokens created afterwards; existing circles stay until #274.
- Where: `planSync` context `reskins`, `reskinOverrideNote`, `reskinReplaceNote` (`packages/owlbear/src/sync-plan.ts`); `pickUploadedArt` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: #274 adds a general re-pick or art change, which can reuse the same set.
- Status: active

## 310.6 The fresh picker stays in the reconcile and is announced with the monster name and "art k of n"

- Decided by: maintainer (#310 body, 2026-10-26) for the labels; keeping the picker in the reconcile is the epic #280 orchestrator's, 2026-10-26, plan gate, not human-approved.
- Context: Owlbear's image picker resolves on a pick or a cancel, so waiting on it cannot hang.
- Options:
  - Chosen: before each picker the sync calls `onArtStep({ monsterName, index, total })`, counting the fresh picks of that reconcile; the panel shows the step in `#art-prompt` and opens itself; the step clears when the picker resolves. A cancel still gives circles for the session (re-asking is #274).
  - Circle first for fresh picks too: every type would need the redraw of 310.5 even when the GM picks at once.
- Where: the fresh-pick loop in `apply` (`packages/owlbear/src/encounter-sync.ts`); `PanelInput.artStep` (`packages/owlbear/src/panel-state.ts`).
- Status: active

## 310.7 The `scene-status` answer carries the art waits, `pick` or `reupload`, with monster names; only a `pick` wait makes the table out of sync

- Decided by: maintainer (#310 body, 2026-10-26) for reporting the wait; the shape and the verdict are the epic #280 orchestrator's, 2026-10-26, plan gate, not human-approved.
- Context: `table_status` compared counts only and could not say why the table was out of sync.
- Options:
  - Chosen: `artWaits: { monsterKey, monsterName, step }[]` on the answer (protocol, default `[]` so an older tab still decodes), passed through by the bridge client, on the engine's `TableSceneStatus`; `getTableStatus` is out of sync while a `pick` wait is open. A `reupload` wait does not change the verdict: its tokens are placed as circles, and a cancelled upload dialog cannot be seen, so it could otherwise never become in sync.
  - Make any wait out of sync: AC4 (every dialog cancelled, in sync) could not hold.
- Where: `sceneStatusSchema` (`packages/protocol/src/protocol.ts`); `TableArtWait`, `getTableStatus` (`packages/engine/src/table/`); `createBridgeTable` (`packages/bridge/src/client.ts`); `artWaits` (`packages/owlbear/src/encounter-sync.ts`), `handleQuery` (`packages/owlbear/src/queries.ts`).
- Status: active

## 310.8 A monster type is named by its first instance whose display name ends in a number, without that number; else by its monster key

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (audit reword), not human-approved.
- Context: the extension knows monster keys and instance display names, not monster names, and the bridge has no monster index.
- Options:
  - Chosen: `monsterTypeName` in the engine, the inverse of the default naming ("<Name> <n>"): the first instance of the type whose display name ends in " <n>", without that suffix; else the monster key (a type with no such instance: listed on connect after a clear, or every instance renamed).
  - Send monster names in the snapshot: the bridge would need the monster index, a new dependency.
  - Show the monster key: readable for most SRD keys, but not the monster name the ticket asks for.
- Where: `monsterTypeName` (`packages/engine/src/encounter/type-name.ts`).
- Status: active

## 310.9 `table_status` says what the GM must do, in its text and as `waitingOnGm` lines in its structured result

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q5), not human-approved; that Claude Code forwards only the structured content is the orchestrator's finding of 2026-10-26.
- Context: the agent sees only the structured payload of a tool that returns both.
- Options:
  - Chosen: one line per step naming the types and what to click (for a re-upload: click Re-upload next to each in the extension panel, then Pick the uploaded image), in the text and as `waitingOnGm: string[]`, present only when a wait is open.
  - Rely on #311's `summary`: AC1's structured half would hold only after both land.
  - Raw `artWaits` records: the maintainer's guidance is that raw records do not orient the agent (#311).
- Where: `table_status` (`packages/mcp/src/tools.ts`).
- Status: active

## 310.10 `undo` with nothing to undo names `restore_encounter` in its text when the last clear can be restored

- Decided by: maintainer (#310 body, 2026-10-26) for the hint; text only and the engine verdict are the epic #280 orchestrator's, 2026-10-26, plan gate (Q3), not human-approved.
- Context: 283.7 made undo after a clear reply "Nothing to undo." with no pointer.
- Options:
  - Chosen: when `canRestoreEncounter` (engine: the last clear left monsters not restored since) is true, the reply is "Nothing to undo. The last clear_encounter can be brought back with restore_encounter."; the structured keys stay as 283.12 sets them (#311 carries the text in `summary`).
  - A structured `hint` key: breaks 283.12's same keys in every case.
- Where: `canRestoreEncounter` (`packages/engine/src/encounter/restore.ts`); `undo` (`packages/mcp/src/tools.ts`).
- Status: active
- Supersedes: 283.7 (the reply only; its records rule stands)

## 310.11 "Pick the uploaded image" is offered only after a Re-upload in this session, and the list follows the order of the art rows

- Decided by: implementer, 2026-10-26, implementation, not human-approved (accepted by the work-ticket orchestrator in review round 1).
- Context: the plan left open whether the pick could run before an upload, and in which order listed types appear ("k of n").
- Options:
  - Chosen: `pickUploadedArt` runs only for a type uploaded this session, matching the panel, which shows the button only then; the list is ordered like the snapshot's art rows. After a reload the GM uploads again, which adds a second copy of the asset to their Owlbear library (same hash-derived name).
  - Offer the pick at any time: saves an upload when the asset is still in the library from an earlier session, but the picker's search finds nothing when it is not.
  - Order by when each type was listed: steadier numbering when a check lands late, at the cost of tracking the order.
- Where: `pickUploadedArt`, the re-upload list (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: duplicate assets in the GM's library become a nuisance.
- Status: active

## 310.12 A second press of Re-upload or Pick for a type whose re-upload or pick is still running is ignored

- Decided by: epic #280 orchestrator, 2026-10-26, PR review (#315), not human-approved.
- Context: the panel rows redraw only when the list changes, so a double click on Re-upload stacked two Owlbear folder dialogs and two asset copies, and a double click on Pick could open two pickers.
- Options:
  - Chosen: an in-flight set keyed by monster key in the sync covers both `reuploadArt` and `pickUploadedArt`; a call for a type with one running returns at once.
  - Disable the buttons in `main.ts`: the rows redraw only on a list change, so the button would not reflect the running call.
- Where: `inflight`, `reuploadArt`, `pickUploadedArt` (`packages/owlbear/src/encounter-sync.ts`); test in `packages/owlbear/src/encounter-sync-reupload-errors.test.ts`.
- Status: active
