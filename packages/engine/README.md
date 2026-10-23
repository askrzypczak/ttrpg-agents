# @ttrpg-agents/engine

The domain engine: dice, monster schema and search, encounter events, and the table port. It has no Node built-ins and imports no other workspace package; the build (`types: []`) and `eslint.config.js` enforce that.

## Monsters

- `src/monsters/schema.ts`: zod schema and the `Monster` type.
- `src/monsters/search.ts`: `searchMonsters(index, query)` (case-insensitive, plural-tolerant, ranked) and `getMonsterByKey`.

## Encounter events

`src/encounter/types.ts` (`monsterInstanceSchema`) and `src/encounter/events.ts` (`encounterEventSchema`) are the source of truth for `MonsterInstance` and `EncounterEvent`; the protocol package reuses them as its wire payloads.

`src/encounter/events.ts`: `observeRepository(repo, emitter)` wraps an `EncounterRepository` and emits `added`, `removed`, `cleared` and `hp-changed` after each successful mutation (not on throws; `removeInstances` emits one `removed` per id; `setHp` and `setMaxHp` emit `hp-changed`). `renameInstance`, `setInitiative` and `setArmorClass` emit no event: renames, initiative and armor class changes reach the bridge by snapshot only. Subscribe through `EncounterEvents.subscribe(listener)`, which returns an unsubscribe function. The engine knows nothing about Owlbear; the bridge sends an `encounter-snapshot` after each `hello-ack` and whenever the database changes (polling `PRAGMA data_version`), and no longer forwards events from the observed repository (the `encounter-event` message type remains in the protocol).

`src/encounter/hp.ts`: the rules behind absolute HP and armor class, which the store calls: `clampHp` (current HP kept within 0..max HP), `resizeMaxHp` (max HP raised to at least 1, current HP lowered to it when above, never raised) and `clampArmorClass` (raised to at least 0). Non-integers throw `InvalidAmountError`, or `InvalidArmorClassError` for armor class.

## Table

`src/table/`: `TablePort` (driven port: `sceneStatus()` asks the table, the VTT, about its scene; fails with `TableUnavailableError`) and `getTableStatus(repo, table)`, which adds the encounter count and the verdict: `inSync` = scene ready and token, applied and encounter counts all equal. The bridge client implements the port; `mcp` only formats the result.
