# @ttrpg-agents/srd

SRD 5.2 monster data adapter: the committed snapshot, its loader and the import script. Implements the `MonsterIndex` port from `@ttrpg-agents/engine`.

## Monsters

- `src/map-open5e.ts`: pure mapper from an Open5e v2 creature to `Monster`.
- `src/loader.ts`: `loadMonsters(sources)` validates and merges JSON files or directories of `*.json` (duplicate keys throw; errors name the file and monster key). `loadAliases(file, index)` adds the alias file's entries (see Aliases). `loadSrdMonsters()` loads the committed snapshot with its aliases. A private source can be added later by passing another `{ path }`.

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
