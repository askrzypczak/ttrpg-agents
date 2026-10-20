# @ttrpg-agents/core

Shared domain code: dice engine, encounter store, and the monster library.

## Monsters

- `src/monsters/schema.ts`: zod schema and the `Monster` type.
- `src/monsters/map-open5e.ts`: pure mapper from an Open5e v2 creature to `Monster`.
- `src/monsters/loader.ts`: `loadMonsters(sources)` validates and merges JSON files or directories of `*.json` (duplicate keys throw; errors name the file and monster key). `loadSrdMonsters()` loads the committed snapshot. A private source can be added later by passing another `{ path }`.
- `src/monsters/search.ts`: `searchMonsters(index, query)` (case-insensitive, plural-tolerant, ranked) and `getMonsterByKey`.

## Encounter events

`src/encounter/events.ts`: `observeRepository(repo, emitter)` wraps an `EncounterRepository` and emits `added`, `removed`, `cleared` and `hp-changed` after each successful mutation (not on throws; `removeInstances` emits one `removed` per id). Subscribe through `EncounterEvents.subscribe(listener)`, which returns an unsubscribe function. Core knows nothing about Owlbear; the bridge sends an `encounter-snapshot` after each `hello-ack` and whenever the database changes (polling `PRAGMA data_version`), and no longer forwards events from the observed repository (the `encounter-event` message type remains in the protocol).

## SRD 5.2 data

`data/srd-5.2/monsters.json` is a committed snapshot of the SRD 5.2 creatures (CC-BY-4.0, see `data/srd-5.2/ATTRIBUTION.md`). It is generated, not hand-edited, and sorted by key so regeneration produces clean diffs. It is excluded from Prettier.

Regenerate (needs network; tests never do):

```
npm run import:srd -w @ttrpg-agents/core
```

The script (`scripts/import-srd.ts`) pages through `https://api.open5e.com/v2/creatures/?document__key=srd-2024&limit=100`, maps and validates each creature, and rewrites the JSON. Upstream data is kept as-is, including known oddities (e.g. Octopus has CHA -3). Known gaps, also upstream: there are no tiny creatures (Open5e lists Bat, Cat, Rat and Sprite as small), and the "Legendary Action Uses" counts are not in the data, so they are not captured (per-action costs are). Per-action usage limits (recharge, N/day) and form restrictions are kept in `usage` and `limitedToForm`.
