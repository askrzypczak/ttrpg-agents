# feature: write initiative edits made in the Owlbear Initiative Tracker back to the store

Issue: [#177](https://github.com/askrzypczak/ttrpg-agents/issues/177). Recorded retroactively on 2026-10-27 (#319) from `docs/architecture.md`, which held this rule's rationale.

## 177.1 Every table write-back is held until its value has stayed unchanged for 1.5 s, whatever the field

- Decided by: maintainer, 2026-10-25, plan gate of #177 (PR #235, additions Add-D and Add-E).
- Context: the Initiative Tracker writes `count` to the item metadata on every keystroke, an empty box included, while Stat Bubbles writes once on Enter or blur (both measured 2026-10-25). Without a delay, each keystroke is planned as an edit and an empty box as an unreadable value.
- Options:
  - Chosen: one settle delay (`EDIT_SETTLE_MS`, 1.5 s) for every edit field (HP, max HP, armor class, initiative): a later value restarts it, an `mcp` change of the field drops the held edit, and an unreadable value is reported only if it is still unreadable when the delay ends. One rule covers any extension added later without checking how it writes.
  - Hold the tracker's `count` only: needs to know how each extension writes, and the check again for every extension added later.
- Where: `EDIT_SETTLE_MS`, `holdEdits`, `holdRejections` (`packages/owlbear/src/encounter-sync.ts`); `docs/architecture.md` ("Table edits are written back").
- Status: active
