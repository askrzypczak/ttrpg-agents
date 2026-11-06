# feature: search_monsters finds 2014 monster names through SRD 5.2 aliases (thug -> Tough)

Issue: [#345](https://github.com/askrzypczak/ttrpg-agents/issues/345).

## 345.1 Old monster names are hand-curated data in `srd`, carried to the engine by a required `MonsterIndex.aliases`

- Decided by: maintainer, 2026-11-06 (the ticket's proposed change: alias file in `srd`, map through the `MonsterIndex` port); the required field and the `loadAliases` export are the work-ticket orchestrator's, 2026-11-06, plan gate (approved at sign-off).
- Context: the snapshot is SRD 5.2 only, and DMs use SRD 5.1 names ("thug"). The agent mapped Thug to Tough from memory, which breaks "the tools are the only source of truth".
- Options:
  - Chosen: `packages/srd/data/srd-5.2/aliases.json` (array of `{ name, key, note }`, hand-edited, untouched by the import script), read by `loadAliases(file, index)`. `MonsterIndex.aliases` maps the old name as written to the current key and is required: `loadMonsters` returns an empty map, so a private source needs no alias file.
  - Optional `aliases` field: no edits to the hand-built test indexes, but every reader handles a missing map.
  - Pairs hard-coded in the engine: no file, but monster data would bypass the port.
  - An `aliasesPath` parameter on `loadSrdMonsters` instead of `loadAliases`: a parameter only the tests pass.
- Where: `packages/srd/data/srd-5.2/aliases.json`; `loadAliases`, `loadSrdMonsters` (`packages/srd/src/loader.ts`); `MonsterIndex` (`packages/engine/src/monsters/types.ts`).
- Status: active

## 345.2 Search lists each monster once, by its strongest match; a current-name match beats an alias match of the same strength

- Decided by: maintainer, 2026-11-06 (the ticket: same rules for aliases, current name ranks above an alias of the same strength, alias hits marked); one entry per monster and the `MonsterMatch` return type are the work-ticket orchestrator's, 2026-11-06, plan gate (approved at sign-off).
- Context: a monster can match by name and by alias at different strengths: "veteran" is a whole word of Warrior Veteran and exactly its alias Veteran.
- Options:
  - Chosen: score the name and every alias of a monster with the existing exact/prefix/word/substring rules; keep the strongest, the name on a tie. Sort by strength, then name before alias, then shorter name, then alphabetical. `searchMonsters` returns `MonsterMatch[]` (`{ monster, alias? }`), `alias` set only when the kept match is an alias. So "veteran" reports Warrior Veteran as an alias hit and the rename is named.
  - Name match always wins when there is one: "veteran" would never name the rename the ticket asked for.
  - A second search function beside `searchMonsters`: two search APIs for one consumer.
- Where: `searchMonsters`, `MonsterMatch` (`packages/engine/src/monsters/search.ts`).
- Status: active

## 345.3 Loading fails on an unknown key, an alias that is a current name, or a repeated old name

- Decided by: maintainer, 2026-11-06 (unknown key and current name: the ticket; repeated old name: plan-gate question).
- Context: the file is hand-edited; a `Map` would let a repeated old name silently overwrite the earlier entry.
- Options:
  - Chosen: `MonsterLoadError` naming the file and the entry for each of the three, compared case-insensitively.
  - Only the ticket's two checks: a repeated old name keeps the last entry unnoticed.
- Where: `loadAliases` (`packages/srd/src/loader.ts`).
- Status: active

## 345.4 The initial set is 18 pairs confirmed against both SRDs

- Decided by: maintainer, 2026-11-06, plan-gate question (options: the ticket's five; five and a follow-up ticket; five and 13 more).
- Context: the ticket named five pairs and allowed more under the same rule. Comparing Open5e's SRD 2014 and 2024 creature data found 13 more 5.1 names that find nothing today and have a successor with the same CR.
- Options:
  - Chosen: all 18, each with its evidence (role and CR, or why it differs) in the PR body.
  - The five only, with a follow-up ticket for the rest: those names stay unfound until it lands.
  - The five only: the snakes, seahorses, sphinxes, quippers and insect swarms keep finding nothing.
- Where: `packages/srd/data/srd-5.2/aliases.json`.
- Revisit if: the snapshot moves to a later SRD; every alias is checked against it again.
- Status: active

## 345.5 An alias hit adds the line "Thug is now Tough (srd-5.2)." and an `alias` field on that result

- Decided by: maintainer, 2026-11-06, plan-gate question.
- Context: the agent reads the structured content's `summary` (311.1), so the rename must be in the text, and the result must say which old name matched.
- Options:
  - Chosen: one line per alias hit among the shown results, `<alias> is now <name> (<source>).`, before the table; the result gains `alias`. The port stays old name to key.
  - `Thug (SRD 5.1 name) is now Tough.`: the alias file's note would travel the port as `{ key, note }`.
  - `Thug is now Tough.`: the source only in the table.
- Where: `search_monsters` (`packages/mcp/src/tools.ts`).
- Status: active

## 345.6 The new skill rules get two prompt evals

- Decided by: maintainer, 2026-11-06, plan-gate question.
- Context: the skill now says not to map old names from memory and to relay renames; without an eval only the wording would check it (186.3 set the precedent of an eval for a new skill rule).
- Options:
  - Chosen: `EVALS.md` rows 41 ("add 3 thugs", rename relayed) and 42 ("add 2 orcs", no match, asks).
  - No rows: no behaviour check for the new rules.
- Where: `.claude/skills/dm-encounter/EVALS.md`, `.claude/skills/dm-encounter/SKILL.md` (Resolving monster names).
- Status: active

## 345.7 When several aliases of one monster match equally, the first in file order is reported

- Decided by: implementer, 2026-11-06, implementation; not human-approved.
- Context: a monster can have several aliases (four SRD 5.1 swarms point to Swarm of Insects). If two match with the same strength and the name matches less strongly, one alias must be reported. It is rare: the swarms' shared words also match the name, which wins the tie, so it takes a fragment such as "de" (in Swarm of Centipedes and Swarm of Spiders, not in Swarm of Insects), which reports Swarm of Centipedes.
- Options:
  - Chosen: the first matching alias in `aliases.json` order (the file is sorted by name).
  - Alphabetical among the matching aliases: the same result while the file stays sorted, at the cost of a sort.
- Where: `searchMonsters` (`packages/engine/src/monsters/search.ts`).
- Status: active
