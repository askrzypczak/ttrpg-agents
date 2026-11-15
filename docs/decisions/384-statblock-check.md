# feature: create-time statblock check in the engine

Issue: [#384](https://github.com/askrzypczak/ttrpg-agents/issues/384).

## 384.1 The check reads the 2024 wordings with markdown bold removed, leftover markup kept as text, and an optional `Hit:` before the damage

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: Statblock text carries markdown bold (`**Melee Attack Roll:**`) and leftover markup from its source (`[Area of Effect]|XPHB|Sphere`). The 2024 books and the test book print `Hit:` before an attack's damage; the SRD snapshot does so once.
- Options:
  - Chosen: remove every `**`, match case-sensitively on the rest, and accept an optional `Hit:` before the damage chain.
  - Also strip `_` and `*` italics: reads the SRD Chain Devil's italic `Wisdom Saving Throw:` and counts 197 save entries against the ticket's 196.
  - No `Hit:`: the test book's and the 2024 books' attacks would lose their damage parts.
- Where: `packages/engine/src/monsters/check.ts` (`checkMonster`).
- Revisit if: a book's wording, or a new snapshot, needs another markup rule.
- Status: active

## 384.2 An attack's damage is the damage right after its reach or range plus every part joined by `plus`; a comma ends it

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: Attack text often adds conditional damage after a comma ("..., plus 2 (1d4) Slashing damage if the attack roll had Advantage") or a two-handed alternative (", or 8 (1d10 + 3) Piercing damage ...").
- Options:
  - Chosen: the chain that starts right after the reach or range, joined by whitespace, `plus`, whitespace; a comma ends it. None there gives no damage parts.
  - Every damage in the text: counts conditional and two-handed damage as part of every hit.
  - The first damage only: drops the regular extra damage of 123 SRD parts.
- Where: `packages/engine/src/monsters/check.ts` (`AttackReport.damage`, `SaveReport.failure`).
- Revisit if: the action rolls epic needs conditional damage as structured data.
- Status: active

## 384.3 An entry rolls when it has an attack, a save or any dice; Multiattack never does; spellcasting alone does not

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: A later roll tool needs to know which entries it can roll (357.3). Multiattack names other actions; spell lists are text.
- Options:
  - Chosen: `rolls` is true for an attack, a save or at least one dice expression, false for an entry named Multiattack (ignoring case and surrounding spaces), and a spell save DC or bonus with no dice does not roll.
  - Attacks and saves only: drops the 18 bare dice, such as "1d4 days", that a roll tool can still roll.
- Where: `packages/engine/src/monsters/check.ts` (`EntryReport.rolls`).
- Revisit if: the action rolls epic parses Multiattack.
- Status: active

## 384.4 Proficiency by CR is computed as `2 + floor((max(cr, 1) - 1) / 4)`

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: The checks need the SRD proficiency bonus for any CR, fractions included.
- Options:
  - Chosen: the formula, which gives the SRD table from CR 0 to 30 and continues it above 30.
  - A literal table: needs a rule above CR 30 anyway.
- Where: `packages/engine/src/monsters/proficiency.ts` (`proficiencyBonus`), not exported from the package.
- Status: active

## 384.5 A dice expression the dice parser rejects is not dice, so the check never throws on entry text

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: Entry text is free text; `parseDice` throws on, for example, `0d6` or `1001d6`.
- Options:
  - Chosen: such text is not listed, not checked and not a damage part.
  - Let `parseDice` throw: one bad entry would break `create_creature` (#385).
- Where: `packages/engine/src/monsters/check.ts` (`checkMonster`).
- Status: active

## 384.6 The spell attack bonus is checked under its own code, `spell_attack_bonus`

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: The epic's table says to check a spellcaster's DC and bonus; the ticket's finding list had no code for the bonus. The plan audit supported adding one.
- Options:
  - Chosen: a `spell_attack_bonus` finding when `+N to hit with spell attacks` is not proficiency plus any ability modifier, ordered after `spell_save_dc`. The SRD's 13 spell attack bonuses all fit.
  - Report it only, as the ticket's list reads: a wrong bonus goes unflagged.
  - Check it under `attack_bonus`: mixes two rules under one code.
- Where: `packages/engine/src/monsters/check.ts` (`CheckFindingCode`).
- Status: active

## 384.7 Only `attack_bonus` findings carry the value per ability; DC findings carry the accepted values only

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate (spec-auditor cut), not human-approved.
- Context: The ticket asks for "the fitting values per ability" on `attack_bonus` only. #385, the only consumer, prints `expected`.
- Options:
  - Chosen: `byAbility` on `attack_bonus` only; every finding has `found` and `expected` (ascending, no repeats).
  - `byAbility` on `save_dc` and `spell_save_dc` too, for symmetry: an unrequested field with no consumer.
- Where: `packages/engine/src/monsters/check.ts` (`CheckFinding.byAbility`).
- Revisit if: a caller needs the per-ability DCs.
- Status: active

## 384.8 The SRD and test-book pin test is a unit test in `packages/srd/src` that reads both committed files and parses them with `monsterSchema`

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate, not human-approved.
- Context: The ticket pins the counts and findings over the SRD snapshot; 374.3 adds the test book's single finding. The test book lives in `fixtures/test-book/`, outside every package.
- Options:
  - Chosen: one test file, `packages/srd/src/check-monster.test.ts`, in the unit project (it only reads committed files); it never reads `source`, so the `source` change of #377 does not affect it.
  - A test in `scripts/`: #374's audit cut that place for the test-book check.
- Where: `packages/srd/src/check-monster.test.ts`.
- Status: active
