# feature: art changes reach a running extension through the change log, with an art source and precedence

Issue: [#378](https://github.com/askrzypczak/ttrpg-agents/issues/378).

## 378.1 The DM's latest explicit choice of art wins; the TooManyTokens default fills only a type with no art; a table set with the stored hash keeps the stored source

- Decided by: maintainer, 2026-11-11 (epic #375 body) for the precedence; the same-hash rule by the epic #375 orchestrator, 2026-11-18, plan gate, not human-approved (from 220.4).
- Context: Stored art had no source, so nothing could keep a default from overwriting chosen art, and no reply could say what an art change replaced (357.7).
- Options:
  - Chosen: each art row records its source (`table`, `agent` or `default`). `assignTokenArt` stores `table` and `agent` art over any art and answers `set` with the art it replaced and that art's source; `default` art over stored art answers `kept` (`has_art`) and writes nothing. A `table` set whose `sha256` equals the stored art's keeps the stored source: a re-upload pick republishes the same image (220.4).
  - Ask before replacing: the maintainer ruled out a confirmation.
  - A fixed rank of sources (for example `table` over `agent`): the DM could not replace a GM pick through the agent.
- Where: `assignTokenArt`, `AssignTokenArtResult`, `TokenArtSource`, `StoredTokenArt` (`packages/engine/src/encounter/token-art.ts`).
- Status: active

## 378.2 Every art write logs an `art-changed` event with no encounter in the same transaction; the extension applies `mcp` art events and ignores `table` ones

- Decided by: maintainer, 2026-11-11 (epic #375 body, ticket #378); the details by the epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: The library import and the bridge's `token-art-set` wrote `token_art` with no change-log event, so a running extension saw art written by anything but its own pick only after a reload (221.5). The agent-set and default art of epic #375 is written during play.
- Options:
  - Chosen: `setTokenArt` takes the source and a `ChangeOrigin` and appends `art-changed` (`monsterKey`, `art`, `origin`; no instance id) to `encounter_events` with a null encounter id, in the same write. The bridge's poll broadcasts it like any row; the protocol reuses the engine schema. The extension applies an `mcp` `art-changed` whatever encounter it holds (#364) and ignores a `table` one, which is the store's record of this tab's own pick.
  - A fresh snapshot when art changes: the bridge would have to detect art changes, and a snapshot redraws nothing for a type already handled (221.5's rejected option).
- Where: `encounterEventSchema` (`packages/engine/src/encounter/events.ts`); `SqliteTokenArtRepository.setTokenArt` (`packages/store-sqlite/src/token-art-repository.ts`); `appendEvent` (`packages/store-sqlite/src/change-log-write.ts`); `handleMessage` in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
- Supersedes: 221.5

## 378.3 `assignTokenArt` reads and writes in one repository write transaction

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate (Q1), not human-approved.
- Context: The bridge (a GM pick) and the MCP server (agent or default art) write the same `token_art` rows from two processes; the precedence reads the stored art before it writes.
- Options:
  - Chosen: `TokenArtRepository.transaction(fn)`, a `BEGIN IMMEDIATE` write transaction in the store that repository calls join (precedent 283.3).
  - No transaction: a GM pick stored between the read and the write could be overwritten by a default.
- Where: `TokenArtRepository.transaction`, `assignTokenArt` (`packages/engine/src/encounter/token-art.ts`); `writeTransaction` (`packages/store-sqlite/src/change-log-write.ts`).
- Status: active

## 378.4 An `mcp` `art-changed` clears the type's session state and checks the new art's liveness once per art change

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate (Q6, Q7), not human-approved.
- Context: The extension kept a type's panel pick for the session over later art (220.8, 274.2) and checked stored art's liveness once per type per session (310.2). Art set through the agent during play must replace a pick and be checked.
- Options:
  - Chosen: an `mcp` `art-changed` sets the type's art, clears its `declined`, `gone`, `checked`, `uploaded` and `panelPicked` entries, runs the per-art step a snapshot runs (a url with a hash gets a liveness check, a url without a hash the bytes backfill), and adds the held encounter's instances of the type to `reskins`. A liveness check of the replaced art that ends after the event changes nothing. A panel pick that resolves after the event still wins. The rule against stale snapshots stands.
  - Keep the session's pick over agent art: the DM's latest choice through the agent would not show until a reload.
- Where: the `art-changed` branch of `handleMessage` and the per-art helper in `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Revisit if: dead-art checks become too frequent.
- Status: active
- Supersedes: 220.8 in part, 274.2 in part, 310.2 in part

## 378.5 Known limit: tokens in scenes other than the held encounter's keep their look after an art change

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate (Q4), not human-approved.
- Context: An art change redraws the held encounter's instances of the type when its scene reconciles. Tokens of the type in other scenes have no reskin entry; a reskin is lost when another scene's snapshot reconciles first.
- Options:
  - Chosen: accept it and document it in the "Who owns what" row "Token art per monster type" of `docs/architecture.md`; no follow-up filed. This matches a Pick art pick today.
  - Redraw every scene: `planSync` would compare each token's recorded look with the type's art, a wider change than this ticket.
- Where: `docs/architecture.md` (Who owns what).
- Revisit if: the maintainer wants every scene redrawn on an art change.
- Status: active

## 378.6 Migration 21 rebuilds `token_art` with `source` NOT NULL and no default

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate (Q8), not human-approved.
- Context: Existing rows need a source: rows with a url came from a GM pick, rows without one from the library import.
- Options:
  - Chosen: rebuild the table as migration 8 did, with `source TEXT NOT NULL CHECK (source IN ('table', 'agent', 'default'))` and no default, filled by `CASE WHEN url IS NULL THEN 'agent' ELSE 'table' END`. A write that omits the source fails loudly.
  - `ADD COLUMN` with a permanent `DEFAULT 'table'`: shorter, but a write that forgot the source would silently store `table`.
- Where: migration 21 (`packages/store-sqlite/src/migrations.ts`).
- Status: active

## 378.7 The library import logs its art changes under one `mcp` origin per run

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: Every art write now needs a `ChangeOrigin`. The origin enum has two values (`table`, `mcp`), and the extension applies every non-`table` change.
- Options:
  - Chosen: `importTokenArtLibrary` mints `{ source: "mcp", commandId }` once per call, so the run reads as one command; its signature is unchanged.
  - An `origin` parameter on `importTokenArtLibrary`: the script is its only production caller (cut by the spec audit).
  - A third origin value for the import: protocol and extension changes for no behaviour difference.
- Where: `importTokenArtLibrary` (`packages/store-sqlite/src/token-art-import.ts`).
- Status: active
