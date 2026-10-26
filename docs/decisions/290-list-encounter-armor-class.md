# feature: list_encounter shows each monster's armor class

Issue: [#290](https://github.com/askrzypczak/ttrpg-agents/issues/290).

## 290.1 Every tool's structured instance carries `armorClass`; the AC text column is in `list_encounter` only

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: Follows up 284.4, which kept armor class out of `list_encounter` in #284 and filed this ticket. After `set_armor_class` or a table edit the agent could not read the new AC back: `list_encounter` showed id, name, HP and initiative, and `get_statblock` shows the monster type's base AC. The ticket left open whether `instanceView` gains the field for every tool or only `list_encounter` does.
- Options:
  - Chosen: `instanceView` gains `armorClass` (number or null), so every tool's structured instances have one shape; the exact-shape assertions over it are updated. The text column (`-` for none) goes in `list_encounter`'s table only, between name and HP as in `add_monsters`' table.
  - Only `list_encounter` adds the field (a spread over `instanceView`): no other test changes, but two view shapes for the same instance.
- Where: `instanceView` and `listEncounterTool` in `packages/mcp/src/tools.ts`; `packages/mcp/README.md` (Tools); `.claude/skills/dm-encounter/SKILL.md` (Never invent numbers); `.claude/skills/dm-encounter/EVALS.md` (row 36).
- Status: active

## 290.2 `set_armor_class` keeps its top-level `armorClass` and `before` fields

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved.
- Context: With 290.1, `set_armor_class`'s `instance` now carries `armorClass`, which repeats its top-level `armorClass` field (decided in #284).
- Options:
  - Chosen: keep the reply shape as #284 left it; the repetition costs nothing.
  - Drop the top-level `armorClass`: changes #284's reply for no consumer.
- Where: `setArmorClassTool` in `packages/mcp/src/tools.ts` (unchanged).
- Status: active

## 290.3 The table-edit case shares one test with the `set_armor_class` case

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (spec audit); not human-approved.
- Context: The AC names a value set by `set_armor_class` or at the table. Both routes reach the stored instance through `repo.setArmorClass`, which `list_encounter` reads whoever wrote it.
- Options:
  - Chosen: one test with two monsters, one changed by `set_armor_class` and one by `applyInstanceEdit` with origin `table`, listed once. Adapter tests prove translation only.
  - Two tests, one per route: easier to read, no extra coverage.
- Where: `describe("list_encounter")` in `packages/mcp/src/tools.integration.test.ts`.
- Status: active
