# feature: reveal Stat Bubbles to players on request

Issue: [#69](https://github.com/askrzypczak/ttrpg-agents/issues/69). Recorded retroactively on 2026-10-25 (#236).

## 69.1 Table wins, per field: a value changed on the table stays until the encounter gives that same field a new value

- Decided by: maintainer, 2026-10-24, recorded retroactively from #69 (plan gate; written into `CLAUDE.md` by PR #196).
- Context: The table already won per metadata key ("VTT wins by default", #162; the #96 reconciler lets a table edit stand until the store's value changes). Stat Bubbles keeps `hide` in the same metadata value as health, max health and armor class (spike #66), so with one baseline per key an HP push would overwrite a `hide` the GM toggled at the table.
- Options:
  - Chosen: `planSync` keeps a baseline per owned key, and a projector with several fields in one key decides each field against the baseline passed as its third argument. Stat Bubbles writes `hide` only when `statsVisible` changed since the baseline.
  - The encounter wins for `hide`, as a boolean pushed on every write: named in the #69 plan and passed over without a recorded reason; every HP change would undo a GM's toggle (reconstructed reason).
  - Table wins per key, the rule before #69: an HP change rewrites the `hide` the GM set (the #69 test "a hide toggled at the table survives an HP change while statsVisible is unchanged").
  - Last write wins by per-field timestamps (reconstructed; #162 puts conflict ordering out of scope): needs comparable clocks on both sides for a one-GM table.
- Where: `planSync` and `Projector` (`project(instance, current, baseline)`) in `packages/owlbear/src/sync-plan.ts`, with the baselines under `SYNCED_METADATA_KEY`; `Projector.editFields` (since #209 HP, max HP and armor class are decided per field too); `statBubblesProjector` in `packages/owlbear/src/stat-bubbles.ts`; `packages/owlbear/README.md` (Encounter sync); `docs/architecture.md` (Who owns what, row Stat Bubbles `hide`); `CLAUDE.md` (Conventions).
- Revisit if: the GM needs to reassert a value the encounter already holds (saying the same value again does not override a table toggle, a known limit in PR #196), or a key holds fields with different owners that cannot be decided one by one.
- Status: active
