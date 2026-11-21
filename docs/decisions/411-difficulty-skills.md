# feature: difficulty in the prep and encounter skills

Issue: [#411](https://github.com/askrzypczak/ttrpg-agents/issues/411).

## 411.1 The skills relay the tool's lines and add one labelled judgement that states no number the tool did not give

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved. Follows 357.6 (maintainer, 2026-11-11): the engine computes the numbers, the judgement is the skill's.
- Context: `assess_difficulty` (#410) returns the party, the XP against the three SRD budgets, the band, a monster table with Multiattack, legendary and lair columns, and the monster-count and HP facts. The ticket asks the skills for a judgement of monster count and action economy on top of those facts.
- Options:
  - Chosen: the skills relay the reply lines as they are, then give a short judgement that opens with the fixed label "My judgement, not a rule:". It may use only the tool's lines, the Multiattack, legendary and lair columns and a statblock, and states no number the tool did not give. The skills match no exact wording of the count cell or the no-monsters line, so a later change to those lines does not break them.
  - A free-form judgement: a reader cannot tell the engine's verdict from the model's opinion, and invented numbers (damage per round, chance of winning) would pass as fact.
  - No judgement: drops the action-economy half of 357.6.
  - Quoting the lines in the skill text: breaks whenever #410's wording changes.
- Where: `## Difficulty` in `.claude/skills/dm-prep/SKILL.md`, `## How hard is this? And the party` in `.claude/skills/dm-encounter/SKILL.md`, rows 9 to 14 of `.claude/skills/dm-prep/EVALS.md`.
- Status: active
