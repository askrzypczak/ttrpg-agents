# feature: correct token art after a cancelled or wrong pick

Issue: [#274](https://github.com/askrzypczak/ttrpg-agents/issues/274).

## 274.1 The panel lists every monster type of the encounter with its art state and a GM-started "Pick art" button, beside the unchanged re-upload box

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (O1 refined, Q1), not human-approved; reusing 310.1's list-and-buttons pattern, and that #273's upload covers any type this control lists, are the maintainer's (epic #326 body, 2026-10-31, M6 and M1); an MCP tool that asks the table to re-pick is out (maintainer, epic #326 body, M5: "Never add a write to the table through a query").
- Context: a cancelled, failed or invalid fresh pick left a type's tokens circles for the session (310.6), and a wrong pick could not be replaced without clearing the encounter or reloading the room.
- Options:
  - Chosen: a "Token art" list (`onTypeArtChange`, `TypeArt`) of each monster type with an instance in the encounter, once, in encounter order, named by `monsterTypeName` (310.8), in one of four states: `art`, `none`, `declined` (its fresh picker was cancelled, failed or returned an invalid image this session) or `reupload` (on the re-upload list). Each row has a "Pick art" button that opens Owlbear's image picker for the type; nothing waits on it. The re-upload box (310.1) stays as it is and still lists gone types with no instance; a re-upload type also appears in Token art, so its art can be replaced too. The panel does not open itself for this list.
  - Leave re-upload types out of Token art: a type listed for re-upload could not be given a different image, which narrows the ticket's "replace the stored art of a monster type".
  - Merge the two lists into one: churns 310's UI, its order and "k of n" labels, and its e2e tests.
  - Reopen the reconcile's fresh picker by itself for a declined type on its next new token: never re-asks when no new token comes, reopens a dialog the GM dismissed, and cannot fix a wrong pick.
- Where: `TypeArt`, `TypeArtState`, `onTypeArtChange`, `repickArt` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `PanelInput.typeArt`, `PanelView.typeArt` (`packages/owlbear/src/panel-state.ts`); `#type-art`, `#type-art-list` (`packages/owlbear/index.html`, `packages/owlbear/src/main.ts`).
- Status: active

## 274.2 A Pick art pick takes the re-upload pick's path: it becomes the type's art, is sent and stored like a fresh pick, wins over a stale snapshot and redraws the type's tokens

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q1), not human-approved; reusing 310.5's `reskins` set for the general re-pick is the maintainer's (epic #326 body, 2026-10-31, M6).
- Context: the re-upload pick (310.5, 220.8) already sets a type's art for the session and redraws its existing tokens; a general re-pick needs the same, and #273's upload-then-pick will too.
- Options:
  - Chosen: one internal helper, `takePanelPick`, shared by `pickUploadedArt` and `repickArt`: it sets the type's art and `panelPicked` (the map 220.8 calls `republished`, renamed because it now holds any art the GM picked from the panel), takes the type out of `declined`, marks it checked, sends a `token-art-set`, stores the bytes as after a fresh pick when the pick carries no hash (one attempt, a failure through `onArtStoreFailed`), adds the type's instances to `reskins` and triggers a reconcile. On a `reupload` type the pick replaces the stored art with its own bytes, which drops the link to the old hash and takes the type off the re-upload list; this is the GM's deliberate choice, and the reconcile's automatic picker still never replaces stored art (223.4, 310.3). The re-upload pick keeps the stored hash and stores nothing, as before. A pick that resolves after the type left the encounter is still applied.
  - Repeat the steps in `repickArt` (and again in #273): three copies of the same eight lines.
  - Leave `reupload` types to the re-upload box only: see 274.1.
- Where: `takePanelPick`, `panelPicked`, `repickArt`, `pickUploadedArt`, `usableArt`, `reuploadList` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 274.3 Every in-place redraw from a panel pick is listed under the overrides

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q2), not human-approved; that any redraw of existing image tokens is listed under the panel's overrides is from the spec-audit notes the maintainer attached to the epic (epic #326 body, 2026-10-31); a visible note for a write over a table value not caused by a known MCP change is the maintainer's (#209, 2026-10-24).
- Context: 310.5 listed an in-place re-skin redraw only when the table had changed the token's art or size, or the token had no recorded look; with Pick art, a wrong pick's image tokens are redrawn with a different image, which the GM sees change on the table.
- Options:
  - Chosen: every in-place redraw from a panel pick (Pick art or the re-upload pick) is listed. Over a table change, or a token with no recorded look, the note is `reskinOverrideNote`, as before; otherwise it is the new `reskinNote` ("<name>'s token was redrawn with the art picked for its monster type."), counted as a `restyle` note so it is reported once its write succeeds. Replacements of circles keep `reskinReplaceNote`; a token already drawn with the pick is not written and gets no note; the redraw for a monster change keeps its own rule (285.11).
  - Keep 310.5's rule: a wrong pick's image tokens would change on the table with no note, against the attached audit note that any redraw is listed.
  - Reuse `reskinOverrideNote(name, false)` ("may have been changed on the table"): no new export, but false for a token the table never touched.
- Where: the in-place reskin branch of `planSync`, `reskinNote` (`packages/owlbear/src/sync-plan.ts`); `writeNoteKind` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
- Supersedes: 310.5 (the in-place note rule only; the redraw stands)

## 274.4 The re-skin notes name "the art picked for its monster type"

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate (Q3), not human-approved.
- Context: the re-skin notes said "the art uploaded for its monster type", which is false for a Pick art pick.
- Options:
  - Chosen: "the art picked for its monster type" in every re-skin note, which fits the re-upload pick, Pick art and #273's upload-then-pick; the overrides intro in `index.html` says "or with art you picked again in this panel".
  - Keep "uploaded": false for Pick art.
  - A wording per path: a note text per caller for the same redraw.
- Where: `reskinNote`, `reskinOverrideNote`, `reskinReplaceNote` (`packages/owlbear/src/sync-plan.ts`); `#overrides` (`packages/owlbear/index.html`).
- Status: active

## 274.5 A type offered in the Token art list, or an open Pick art picker, is not an art wait

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate, not human-approved; that a declined type offered again must not make `table_status` out of sync is from the spec-audit notes the maintainer attached to the epic (epic #326 body, 2026-10-31).
- Context: only a `pick` wait (a fresh picker of the running reconcile) makes `table_status` out of sync (310.7).
- Options:
  - Chosen: the list adds nothing to `artWaits`, and a panel pick never touches the reconcile's `picking` queue, so `getTableStatus` stays in sync while a declined type is offered or its Pick art picker is open. The engine, protocol, bridge and MCP do not change.
  - Report an open Pick art picker as a `pick` wait: the table would read out of sync while the GM merely looks at the picker, with nothing the agent can do about it.
- Where: `artWaits`, `repickArt` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 274.6 A Pick art press is ignored while the type's pick, re-upload or fresh picker runs, or when the type is not in the list

- Decided by: epic #326 orchestrator, 2026-10-31, plan gate, not human-approved.
- Context: the panel rows redraw only when the list changes, so a double click could stack two pickers (as 310.12 found for the re-upload buttons, which this extends), and a press during the reconcile's own picker for the type would race it.
- Options:
  - Chosen: `repickArt` returns at once for a type not in the current Token art list, one in the shared `inflight` set (a re-upload, a pick of the uploaded image or a Pick art still running; #273's upload joins it), or one whose fresh picker is open or queued in the running reconcile. A cancelled, failed or invalid pick changes nothing and the GM can press again.
  - Disable the buttons in `main.ts`: the rows redraw only on a list change, so the button would not reflect the running call.
- Where: `inflight`, `picking`, `repickArt` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 274.7 The reconcile opens no fresh picker for a type whose Pick art picker is open; its new tokens are circles until a valid pick, from the panel or a later fresh picker, redraws them

- Decided by: reviewer, 2026-10-31, review round 1 (applied by the #274 builder, a work-ticket sub-agent of the epic #326 orchestrator), not human-approved; the re-skin of those circles by a later valid fresh pick is the epic #326 orchestrator's, 2026-10-31, PR review (first review of #331), not human-approved, following "Art chosen later replaces the circle" (maintainer, #310 body).
- Context: 274.6 kept a Pick art press away from a running fresh picker, but not the other way round. A type listed `none` (for example while the scene was not ready) whose Pick art picker was open got a second, fresh picker from the next reconcile; the two picks could then leave the tokens drawn with one image and the store holding the other.
- Options:
  - Chosen: the reconcile's fresh-pick queue skips a type in `inflight`. Its new tokens are drawn as circles; a valid Pick art pick then redraws them through `reskins` (each replacement listed, 274.3), and a cancelled one leaves the type as it was, not declined, so a later new token still gets the fresh picker. A valid fresh pick adds every instance of its type to the reskins of that reconcile, so circles drawn while the type had no art are replaced in the same reconcile (each replacement listed), and a reconcile that fails puts them back for the retry.
  - Make the reconcile wait for the open Pick art picker: the reconcile would block on a GM dialog, which 310.1 rules out for panel buttons.
  - Let both pickers run and keep the later answer: the table and the store could still disagree for the session, and the GM sees two pickers for one type.
  - After a later valid fresh pick, leave the circles until the GM presses Pick art: the row would read "has token art" over circles, against "Art chosen later replaces the circle".
- Where: the fresh-pick queue filter and the fresh-pick loop in `apply`, `inflight` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
