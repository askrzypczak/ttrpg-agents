# chore: stored creatures behind a CreatureRepository port, merged into the monster index

Issue: [#381](https://github.com/askrzypczak/ttrpg-agents/issues/381).

## 381.1 Stored creatures sit behind a writable `CreatureRepository` port whose store throws its own errors

- Decided by: maintainer, 2026-11-11, epic #376 body and the ticket (the port and its five methods); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (the error behaviour).
- Context: `create_creature` (#385) inserts, `edit_creature` and `remove_creature` (#386) replace and delete, and the index reads. The use cases check names and keys before they write, so a store error only guards a race between two processes.
- Options:
  - Chosen: `getRecord`, `listRecords` (key order; `data` is parsed JSON, `unknown`, not validated by the store), `insert` (throws when the key exists, stores nothing), `replace` (throws when no record has the key), `delete` (does nothing when there is none). The store's own error is thrown; no new error class.
  - A typed error class per failure: a carrying cost with no reader, since the use cases report their own messages.
  - Only `getRecord`, `listRecords` and `insert` now, the rest with #386: cheaper, but the ticket names all five and #386 would reopen the port.
- Where: `packages/engine/src/monsters/creatures.ts` (`CreatureRepository`, `CreatureRecord`), `packages/store-sqlite/src/creature-repository.ts` (`SqliteCreatureRepository`).
- Status: active

## 381.2 `createMonsterIndex` merges the built-in set with the stored creatures and reads the store on every call

- Decided by: maintainer, 2026-11-11, epic #376 body (`createMonsterIndex(builtIn, creatures)`, reads the store on each call); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (no cache, the order).
- Context: Several MCP processes share one database file; a creature one process stores must be visible to every other at once.
- Options:
  - Chosen: no cache. `get` tries the built-in set first, then the store; `list` is the built-in monsters in set order, then the stored creatures in key order; `aliases` and `dndBeyondPage` are the built-in set's. `MonsterIndex` itself is unchanged.
  - A cache keyed on a store revision: allowed by the ticket, but nothing is slow enough yet to need it.
- Where: `packages/engine/src/monsters/creatures.ts` (`createMonsterIndex`), `packages/mcp/src/stdio.ts`.
- Revisit if: reading the store on every call shows up in a profile.
- Status: active

## 381.3 A change to `monsterSchema` ships a store migration for the `creatures` rows; the index skips a row that fails the schema as a safety net only

- Decided by: maintainer, 2026-11-15, in chat (relayed by the epic #376 orchestrator after the PR opened).
- Context: Creation and edit validate a statblock before they store it (#385, #386), so a row that fails `monsterSchema` can only come from a later schema change or a hand-edited database. A schema change is a migration concern, as #377 rewrote the SRD file's `source`.
- Options:
  - Chosen: `createMonsterIndex` parses each row with `monsterSchema.safeParse` and skips one that fails: absent from `get`, `list` and search, with no message and no throw. Key, namespace and `srd` book-tag rules are enforced at creation and edit only.
  - Per-read quarantine with messages: the index checks key, namespace and book tag too, lists failing rows through a `MonsterIndex.quarantined()` method, and every unknown-monster error names the reason. Built in the first round of this ticket and cut: it widens the read port and every use case's error path for a state that a migration should never leave behind, and "quarantined" has no meaning in a create, edit, remove model.
  - Refuse to start on a bad row: one hand-edited row would stop every tool.
- Where: `packages/engine/src/monsters/creatures.ts` (`createMonsterIndex`), `docs/architecture.md` (Shared database, `creatures`).
- Revisit if: rows that fail the schema turn up in practice, so the DM needs to see them.
- Status: active

## 381.4 A monster counts as stored when its book tag is not reserved; `isReservedBookTag` is the one place the rule lives

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: Search must rank stored creatures first on a tie (381.5) without a new port method, and #385 must refuse `srd` book tags.
- Options:
  - Chosen: `isReservedBookTag(book)` (`book.startsWith("srd")`), engine-internal (not exported from the package, as `proficiencyBonus` in 384). "Not reserved" means stored because creation and edit keep every stored record off reserved tags.
  - A port method such as `isStored(key)`: every index implementation must serve it.
- Where: `packages/engine/src/monsters/creatures.ts` (`isReservedBookTag`), `packages/engine/src/monsters/search.ts` (`searchMonsters`).
- Revisit if: a built-in data set gets a book tag that does not start with `srd`.
- Status: active

## 381.5 Search ranks a stored creature before a built-in monster on a tie

- Decided by: maintainer, 2026-11-11 (357.16: a creature the DM stored wins over an SRD monster of the same name, ranked first on a tie; the ticket's Proposed change); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (the position of the new key in the sort).
- Context: 345.2's sort had no notion of stored creatures.
- Options:
  - Chosen: strength, then name before alias, then stored before built-in, then shorter name, then alphabetical.
  - Stored before built-in ahead of strength: a weak stored match would outrank an exact SRD match.
  - Stored before built-in after the shorter-name key: a stored "Bugbear Stalker" would not beat the SRD one, both names having the same length only by chance.
- Where: `packages/engine/src/monsters/search.ts` (`searchMonsters`).
- Status: active
- Supersedes: 345.2

## 381.6 The `creatures` table holds a key and the statblock JSON, with no timestamps

- Decided by: maintainer, 2026-11-11, the ticket (a `creatures` table, migration); epic #376 orchestrator, 2026-11-15, plan gate, on the spec-auditor's cut, not human-approved (no timestamp columns).
- Context: The ticket proposed `created_at` and `updated_at`; nothing in #381, #385 or #386 reads them.
- Options:
  - Chosen: migration 20, `creatures (key TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data)))`.
  - The ticket's timestamp columns: a persisted format with no reader.
- Where: `packages/store-sqlite/src/migrations.ts` (migration 20), `packages/store-sqlite/src/creature-repository.ts`.
- Revisit if: a feature needs to know when a creature was stored or edited (one migration adds the columns).
- Status: active

## 381.7 The in-memory `CreatureRepository` fake stays in its test file until a second consumer needs it

- Decided by: spec-auditor, 2026-11-15, folded by the #381 planner; epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (routine rule: #385 promotes it).
- Context: Engine rules (the merge, the skipped row) are tested in the engine, not in the store's adapter tests, so the engine tests need a repository.
- Options:
  - Chosen: a fake local to `creatures.test.ts`; #385, the second consumer, moves it to `@ttrpg-agents/engine/testing`.
  - Export a fake from `@ttrpg-agents/engine/testing` now: an export with one consumer.
  - Test the engine rules through `SqliteCreatureRepository`: adapter tests would re-test engine rules.
- Where: `packages/engine/src/monsters/creatures.test.ts`.
- Status: active
