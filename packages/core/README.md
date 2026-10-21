# @ttrpg-agents/core

Shared domain code: dice engine, monster schema and search, and encounter events.

## Monsters

- `src/monsters/schema.ts`: zod schema and the `Monster` type.
- `src/monsters/search.ts`: `searchMonsters(index, query)` (case-insensitive, plural-tolerant, ranked) and `getMonsterByKey`.

## Encounter events

`src/encounter/events.ts`: `observeRepository(repo, emitter)` wraps an `EncounterRepository` and emits `added`, `removed`, `cleared` and `hp-changed` after each successful mutation (not on throws; `removeInstances` emits one `removed` per id). Subscribe through `EncounterEvents.subscribe(listener)`, which returns an unsubscribe function. Core knows nothing about Owlbear; the bridge sends an `encounter-snapshot` after each `hello-ack` and whenever the database changes (polling `PRAGMA data_version`), and no longer forwards events from the observed repository (the `encounter-event` message type remains in the protocol).
