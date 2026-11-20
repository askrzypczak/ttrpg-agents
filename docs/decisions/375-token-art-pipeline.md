# Epic O: token art pipeline

Issue: [#375](https://github.com/askrzypczak/ttrpg-agents/issues/375).

Decisions that belong to the epic as a whole, not to one child. Each child's own decisions are in its file: 378, 379, 380, 382, 383, 387 and 389.

## 375.1 The epic's three open questions were built on the epic body's suggested defaults, with the maintainer asked to confirm or veto

- Decided by: epic #375 orchestrator, 2026-11-18, at the start of the run, not human-approved.
- Context: The epic body (maintainer, 2026-11-11) listed three open questions with a suggested default each: how the default variant is chosen, what frame the DM's own tokens get, and what happens when a default fetch fails although the machine is online. The children were written on those defaults. The maintainer was away, and the children that depend on each answer were the next to run.
- Options:
  - Chosen: proceed on the suggested defaults and ask the maintainer in the orchestrator's chat. The default variant is the first file of the folder in code-unit order (379.3); own-image tokens get one fixed thin dark-bronze ring (380.4); a failed default fetch goes on after the 5 s timeout, the reply names the type and the reason, and the GM gets the picker as today (383.3).
  - Wait for the maintainer's answers before planning #379, #380 and #383: the run would have stalled on its second day with nothing else released.
- Where: `defaultVariant` (`packages/engine/src/encounter/too-many-tokens.ts`); `TOKEN_STYLE` (`packages/engine/src/encounter/tokeniser.ts`); `loadDefaultArt` (`packages/engine/src/encounter/default-art.ts`).
- Revisit if: the maintainer picks another option for any of the three; each is one child's change (379.3, 380.4 and 383.3 say where).
- Status: active

## 375.2 The S3 host child (#289) is not run in this epic

- Decided by: epic #375 orchestrator, 2026-11-18, at the start of the run, not human-approved; the deferral itself is the maintainer's (epic body, 2026-11-11: it waits on the maintainer's decision once scene-bound encounters are in use, and nothing depends on it).
- Context: With no host, the DM's own art reaches the table through the extension panel's Re-upload and Pick steps (382.4). Every other child is independent of #289. The epic cannot close while #289 is an open child, so whether it leaves the epic or stays as a later child is the maintainer's call.
- Options:
  - Chosen: leave #289 out of the run, labelled `orchestrate-epic-run` so the poller leaves it alone, and ask the maintainer whether it leaves the epic.
  - Run it now: it needs a provider choice, credentials and a hand check the maintainer has not made, and its ticket says to wait.
- Where: `#289`; the "Who owns what" token art row in `docs/architecture.md` (378) already describes art without a url as the no-host path.
- Revisit if: the maintainer decides on a host after Epic M is in use.
- Status: active
