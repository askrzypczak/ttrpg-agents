# feature: engine computes XP, budgets and a difficulty assessment

Issue: [#404](https://github.com/askrzypczak/ttrpg-agents/issues/404). Applies the epic's entries 396.1 to 396.4 (`396-encounter-difficulty.md`) without re-logging them.

## 404.1 The rule tables have exactly the SRD's rows: one per CR of 0, 1/8, 1/4, 1/2 and 1 to 30, and one per level 1 to 20; any other row is refused

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: The ticket asks the schema to reject a missing or repeated CR or level. An extra row (a CR of 31, or 0.3) would change which row is "next" for lair XP and give a CR the table should lack an XP value.
- Options:
  - Chosen: `difficultyTablesSchema` refuses a CR row outside the fixed list and a level row outside 1 to 20, naming the value at its path.
  - Accept extra rows: a typo in `difficulty.json` would silently change lair XP and make a guessed CR count.
- Where: `packages/engine/src/difficulty/tables.ts` (`difficultyTablesSchema`).
- Status: active

## 404.2 With `inLair`, only a monster with a lair variant counts the next CR row's XP

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: 396.2 makes lair XP a per-call flag; the SRD gives lair XP only for statblocks that say "or N in lair". Whether the flag raises every monster or only those is an engine rule, and adapter tests do not re-test engine rules.
- Options:
  - Chosen: `assessDifficulty` passes `inLair` to `xpForCr` only for a monster whose `lairVariant` fact is true; every other monster counts its plain XP.
  - Raise every monster: overstates monsters that have no lair, such as the minions of a dragon in its lair.
  - Leave the choice to `assess_difficulty` (#410): an engine rule in an adapter.
- Where: `packages/engine/src/difficulty/assess.ts` (`assessDifficulty`).
- Status: active

## 404.3 At the table's highest CR, lair XP is that row's own XP

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: `xpForCr` with `inLair` returns the next row's XP. In a validated table only CR 30 has no next row, and no SRD CR 30 monster has a lair variant.
- Options:
  - Chosen: the row's own XP, so the monster still counts.
  - Undefined: the monster would drop out of XP as a `cr-not-in-table` problem although its CR is in the table.
- Where: `packages/engine/src/difficulty/tables.ts` (`xpForCr`).
- Revisit if: a CR 30 creature with a lair variant is stored and the DM expects more XP for it.
- Status: active

## 404.4 Problem monsters count toward the monster count, crowding and the HP totals; only XP leaves them out

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: An instance whose monster is unknown, or whose CR the table lacks, has no XP. It is still on the table and still fights.
- Options:
  - Chosen: such instances (and hypothetical monsters whose CR the table lacks) are listed as problems, left out of XP and counted everywhere else.
  - Leave them out of every total: the monster count and the crowding flag would understate the encounter.
- Where: `packages/engine/src/difficulty/assess.ts` (`assessDifficulty`).
- Status: active

## 404.5 A hypothetical count is checked in the engine: an integer of 1 or more, else `InvalidCountError`

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: The count comes from an adapter (#410's `assess_difficulty`). The engine computes every number it reports, so it does not trust an adapter's input check alone.
- Options:
  - Chosen: `assessDifficulty` throws `InvalidCountError` (code `invalid_count`), naming the monster key and the count, for 0, a negative count or a fraction.
  - Trust the count, with #410's input schema as the only guard: a fraction or negative count would give a fractional or negative total.
- Where: `packages/engine/src/difficulty/assess.ts` (`assessDifficulty`), `packages/engine/src/difficulty/errors.ts` (`InvalidCountError`).
- Status: active

## 404.6 The three statblock facts are read from entry names, ignoring case

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: The epic plan asks for facts, not parsing. In the SRD snapshot 178 monsters have an action named "Multiattack", 30 have legendary actions and 27 have an entry whose name contains "in Lair".
- Options:
  - Chosen: `multiattack` = an action named "Multiattack"; `legendaryActions` = a legendary action; `lairVariant` = an entry in any section whose name contains "in lair"; names compared ignoring case, as creature changes match entry names.
  - Exact case: a stored creature typed "multiattack" would read as having none.
- Where: `packages/engine/src/difficulty/assess.ts` (`assessDifficulty`).
- Status: active

## 404.7 `assessDifficulty` reads monsters through `Pick<MonsterIndex, "get">` and takes the party as an inline `{ size, level }`

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate, not human-approved.
- Context: The ticket names a lookup `(key) => Monster | undefined`. The engine already has that read port, and `createCreature` takes the index the same way. #408 owns the party's engine names (`Party` and the rest) on a parallel branch.
- Options:
  - Chosen: deps `{ tables, monsters: Pick<MonsterIndex, "get"> }`, so `ctx.monsters` (built-in and stored creatures) passes as is; the request's `party` is an inline structural type, and nothing here imports `./party/`. #410 passes #408's `Party`, which fits structurally.
  - A bare lookup function: one more shape for the same port.
  - A party type of this module's own: a second name for #408's value.
- Where: `packages/engine/src/difficulty/assess.ts` (`AssessDifficultyDeps`, `AssessDifficultyRequest`).
- Status: active

## 404.8 The assessment does not echo `inLair`

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate (spec audit), not human-approved.
- Context: The draft result had an `inLair` field. #410 holds its own input, and each monster type's `lairVariant` and `xpEach` already show the flag's effect.
- Options:
  - Chosen: no `inLair` field on `DifficultyAssessment`.
  - Echo it: a field no consumer reads.
- Where: `packages/engine/src/difficulty/assess.ts` (`DifficultyAssessment`).
- Status: active
