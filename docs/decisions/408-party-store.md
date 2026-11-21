# feature: store the party's size and level

Issue: [#408](https://github.com/askrzypczak/ttrpg-agents/issues/408).

## 408.1 Missing party numbers are reported before range errors, each message names every failing number, and one error class carries both

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved. The one-class choice is a spec-auditor cut the orchestrator accepted at the plan gate.
- Context: `setParty` and `resolveParty` can meet a number that is neither given nor stored, or one out of range (size a whole number of 1 or more, level a whole number from 1 to 20). MCP relays any `DomainError` as its message only (`packages/mcp/src/tools.ts`), so the agent reads the wording, not the code.
- Options:
  - Chosen: one private check, missing numbers first (`Party size is not set.`, `Party level is not set.`, `Party size and level are not set.`), then range, one sentence per bad number, size first. One class, `InvalidPartyError` (`invalid_party`).
  - A separate `party_not_set` class: no consumer reads the code.
  - Range first: an override of 0 with no level stored still hides one of the two problems until the next call.
- Where: `packages/engine/src/party/party.ts` (`setParty`, `resolveParty`), `packages/engine/src/party/errors.ts` (`InvalidPartyError`).
- Status: active

## 408.2 `setParty` reads and writes the party outside a transaction

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved.
- Context: Changing one number reads the stored party, merges, checks and writes. Two `set_party` calls at the same moment could lose one update.
- Options:
  - Chosen: `get` then `set` through the two-method `PartyStore` port. The supported setup is one machine with one GM (CLAUDE.md), so the race does not occur in practice.
  - An atomic port method that updates one number in SQL: a wider port for a race the supported setup does not have.
- Where: `packages/engine/src/party/party.ts` (`setParty`, `PartyStore`).
- Revisit if: several agents or GMs share one database.
- Status: active

## 408.3 The `party` table has no range CHECK constraints; the engine is the only writer and checks first

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved. A spec-auditor cut the orchestrator accepted.
- Context: Migration 21 adds the one-row `party` table. Other tables back their engine rules with CHECKs (`max_hp`, `footprint`).
- Options:
  - Chosen: `id INTEGER PRIMARY KEY CHECK (id = 1)`, `size` and `level` `INTEGER NOT NULL`, nothing more. `SqlitePartyStore` does not validate.
  - Backstop range CHECKs: no consumer, plus a store test to pin them.
- Where: `packages/store-sqlite/src/migrations.ts` (migration 21), `packages/store-sqlite/src/party-store.ts` (`SqlitePartyStore`).
- Revisit if: a second writer (another adapter or a script) writes the table.
- Status: active
