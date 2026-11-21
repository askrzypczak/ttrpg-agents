# Epic P: encounter difficulty

Decisions for [#396](https://github.com/askrzypczak/ttrpg-agents/issues/396) that belong to no single child. The epic body listed four open questions for the maintainer with suggested defaults; the children were filed to those defaults, and the epic orchestrator ran with them so the maintainer can veto any of them when reviewing the epic PR.

## 396.1 A CR 0 monster counts 10 XP, always

- Decided by: epic #396 orchestrator, 2026-11-21, before the first plan gate; not human-approved. Suggested default of the epic body (open question 1).
- Context: The SRD's "Experience Points by Challenge Rating" table gives CR 0 as "0 or 10". Of the 30 CR 0 statblocks, 27 state 10 XP and 3 (Giant Fly, Shrieker Fungus, Seahorse) state 0; the snapshot does not record the difference.
- Options:
  - Chosen: the table row is `cr: 0, xp: 10`; the three 0-XP monsters are overstated by 10 XP each, which no budget band turns on.
  - Always 0: understates 27 monsters.
  - 10 with a committed list of the three exceptions: a hand-maintained list for 30 XP of precision.
- Where: `packages/srd/data/srd-5.2/difficulty.json` (#407, whose test on the committed file pins the row), `packages/srd/README.md`. The engine schema (#404) does not pin the value.
- Revisit if: the DM asks why a swarm of CR 0 creatures counts, or the snapshot gains per-monster XP.
- Status: active

## 396.2 Lair XP is a per-call `inLair` flag, off by default; the assessment always names monsters with a lair variant

- Decided by: epic #396 orchestrator, 2026-11-21, before the first plan gate; not human-approved. Suggested default of the epic body (open question 2).
- Context: 27 SRD statblocks add "or N in lair", and in all 27 N is the XP of the next CR.
- Options:
  - Chosen: `xpForCr(tables, cr, { inLair })` returns the next CR row's XP when the flag is set; `assess_difficulty` takes `inLair` (default false) and its reply names the monsters that have a lair variant, so the DM knows the flag matters.
  - Never count lair XP: hides a number the SRD states.
  - Both totals side by side on every call: noise for the many encounters with no lair monster.
- Where: `xpForCr`, `assessDifficulty` (#404); `assess_difficulty` (#410).
- Status: active

## 396.3 The party has one level

- Decided by: epic #396 orchestrator, 2026-11-21, before the first plan gate; not human-approved. Suggested default of the epic body (open question 3).
- Context: The SRD's budget is per character and would allow summing characters of different levels. 357.4 keeps a party model out.
- Options:
  - Chosen: `{ size, level }`, budgets = per-character value times size. Mixed levels wait until the DM asks.
  - A list of levels: a per-character structure, the first step toward the party model 357.4 excludes.
- Where: `PartyStore`, `setParty`, `resolveParty` (#408); the `party` table (migration 21).
- Revisit if: a DM with a mixed-level party asks for it.
- Status: active

## 396.4 Every instance counts toward the encounter's XP, including those at 0 HP; the result says how many are at 0 HP

- Decided by: epic #396 orchestrator, 2026-11-21, before the first plan gate; not human-approved. Suggested default of the epic body (open question 4).
- Context: Prep is the main use of the assessment, where every monster is at full HP; at the table a downed monster still shaped the fight.
- Options:
  - Chosen: count every instance; report the count at 0 HP and the current and max HP totals so the agent can qualify a mid-fight answer.
  - Leave 0-HP instances out: a mid-fight assessment would drift from the encounter as prepared.
  - A per-call choice: one more parameter for a question nobody has asked.
- Where: `assessDifficulty` (#404).
- Status: active
