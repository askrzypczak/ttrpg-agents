# @ttrpg-agents/srd

SRD 5.2 monster data adapter: the committed snapshot, its loader and the import script. It loads the built-in `MonsterSet`, which the engine's `createMonsterIndex` merges with the stored creatures and serves through the `MonsterIndex` port.

## Monsters

- `src/map-open5e.ts`: pure mapper from an Open5e v2 creature to `Monster`.
- `src/loader.ts`: `loadMonsters(sources)` validates and merges JSON files or directories of `*.json` (duplicate keys throw; errors name the file and monster key). `loadAliases(file, set)` adds the alias file's entries (see Aliases). `loadDndBeyondPages(file, set)` adds the D&D Beyond page file's entries (see D&D Beyond pages). `loadSrdMonsters()` loads the committed snapshot with its aliases and pages. The loaders return a `MonsterSet`. `loadSrdDifficultyTables()` loads the SRD XP tables (see Difficulty tables).

## SRD 5.2 data

`data/srd-5.2/monsters.json` is a committed snapshot of the SRD 5.2 creatures (CC-BY-4.0, see `data/srd-5.2/ATTRIBUTION.md`). It is generated, not hand-edited, and sorted by key so regeneration produces clean diffs. It is excluded from Prettier.

Regenerate (needs network; tests never do):

```
npm run import:srd -w @ttrpg-agents/srd
```

The script (`scripts/import-srd.ts`) pages through `https://api.open5e.com/v2/creatures/?document__key=srd-2024&limit=100`, maps and validates each creature, and rewrites both files. Upstream data is kept as-is, including known oddities (e.g. Octopus has CHA -3). Known gaps, also upstream: there are no tiny creatures (Open5e lists Bat, Cat, Rat and Sprite as small), and the "Legendary Action Uses" counts are not in the data, so they are not captured (per-action costs are). Per-action usage limits (recharge, N/day) and form restrictions are kept in `usage` and `limitedToForm`.

`data/srd-5.2/monsters.meta.json` records the snapshot's provenance: `source` (`open5e-v2`), `url`, `fetchedAt` (UTC date of the import) and `count`. The import script writes it. The initial file was written by hand, without network, so its `fetchedAt` (2026-10-17) is the commit date of the snapshot, not a recorded fetch time.

## Aliases

`data/srd-5.2/aliases.json` maps old monster names (SRD 5.1 names, as DMs still say them) to the key of their SRD 5.2 successor. It is a JSON array of `{ "name", "key", "note" }` entries sorted by name. It is hand-curated, not generated: the import script does not write it.

`loadAliases` (used by `loadSrdMonsters()`) fails, naming the file and entry, when an entry is malformed, its key is not in the snapshot, its name is a current monster name, or its name repeats an earlier entry (names compare case-insensitively). The test suite checks that every committed alias resolves.

A new pair needs evidence in its PR that it is the SRD 5.1 to 5.2 successor: the same role and CR, or the reason it differs.

## D&D Beyond pages

`data/srd-5.2/dndbeyond.json` is a JSON object that maps each monster key to its D&D Beyond 2024 page path `<id>-<slug>` (the part after `/monsters/`), sorted by key. It is hand-curated from the maintainer's harvest of the Free Rules creature page (see #278), not written by the import script. The slug is required: D&D Beyond returns 404 without it.

`loadDndBeyondPages` (used by `loadSrdMonsters()`) fails, naming the file and entry, when the file is not an object, a key is not in the snapshot or a value is not `<id>-<slug>`. Giant Fly has no 2024 page and no entry; the test suite lists it as the one exception.

## Difficulty tables

`data/srd-5.2/difficulty.json` holds the SRD 5.2 XP by challenge rating (`xpByCr`) and XP budget per character by level (`budgetPerCharacter`: Low, Moderate, High), in the engine's `DifficultyTables` shape. It is hand-maintained, not generated: the numbers were transcribed from public CC-BY Markdown copies of the SRD text (decision 407.1), not from the PDF. The engine computes every number from it.

`loadDifficultyTables(file)` validates a file with the engine's `difficultyTablesSchema`, and `loadSrdDifficultyTables()` loads the committed one. Both throw `MonsterLoadError` naming the file and the failing path. A unit test pins the SRD's three worked examples against the file and checks that every CR used by a snapshot monster has a row.

CR 0 is 10 XP, always (decision 396.1). The SRD says "0 or 10"; Giant Fly, Shrieker Fungus and Seahorse state 0 XP in the snapshot's source, so the assessment overstates each by 10.
