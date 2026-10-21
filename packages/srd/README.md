# @ttrpg-agents/srd

SRD 5.2 monster data adapter: the committed snapshot, its loader and the import script. Implements the `MonsterIndex` port from `@ttrpg-agents/core`.

## Monsters

- `src/map-open5e.ts`: pure mapper from an Open5e v2 creature to `Monster`.
- `src/loader.ts`: `loadMonsters(sources)` validates and merges JSON files or directories of `*.json` (duplicate keys throw; errors name the file and monster key). `loadSrdMonsters()` loads the committed snapshot. A private source can be added later by passing another `{ path }`.

## SRD 5.2 data

`data/srd-5.2/monsters.json` is a committed snapshot of the SRD 5.2 creatures (CC-BY-4.0, see `data/srd-5.2/ATTRIBUTION.md`). It is generated, not hand-edited, and sorted by key so regeneration produces clean diffs. It is excluded from Prettier.

Regenerate (needs network; tests never do):

```
npm run import:srd -w @ttrpg-agents/srd
```

The script (`scripts/import-srd.ts`) pages through `https://api.open5e.com/v2/creatures/?document__key=srd-2024&limit=100`, maps and validates each creature, and rewrites the JSON. Upstream data is kept as-is, including known oddities (e.g. Octopus has CHA -3). Known gaps, also upstream: there are no tiny creatures (Open5e lists Bat, Cat, Rat and Sprite as small), and the "Legendary Action Uses" counts are not in the data, so they are not captured (per-action costs are). Per-action usage limits (recharge, N/day) and form restrictions are kept in `usage` and `limitedToForm`.
