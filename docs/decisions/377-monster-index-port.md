# chore: MonsterIndex becomes a read port, and source becomes a book tag

Issue: [#377](https://github.com/askrzypczak/ttrpg-agents/issues/377).

## 377.1 `MonsterIndex` is a read port; the built-in SRD data is a `MonsterSet` that the engine's `staticMonsterIndex` serves

- Decided by: maintainer, 2026-11-11, epic #376 body (the port, `MonsterSet`, `staticMonsterIndex`); epic #376 orchestrator, 2026-11-14, plan gate, not human-approved (`staticMonsterIndex` lives in `types.ts`, by the epic's rule that #377 edits only existing lines of `monsters/index.ts`).
- Context: Use cases read the index's `byKey` map directly, so nothing but a rebuilt value could feed monsters in, and stored creatures (357.10, #381) need a second source. The `aliases` map (345.1) and the `dndBeyondPages` map (278.2) stay required on `MonsterSet` and are read through `aliases()` and `dndBeyondPage(key)`.
- Options:
  - Chosen: an interface `get`, `list`, `aliases`, `dndBeyondPage`; today's struct renamed `MonsterSet`; `staticMonsterIndex(set)` wraps a set by reference.
  - `loadSrdMonsters()` returns a `MonsterIndex` directly: #381's `createMonsterIndex(builtIn, creatures)` could not merge the raw set.
  - Keep the struct and rebuild it on every change: a creature made in one process would not be visible at once to every process.
  - `staticMonsterIndex` in a new file: needs a new export line in `monsters/index.ts`, which #384 edits in parallel.
- Where: `packages/engine/src/monsters/types.ts` (`MonsterSet`, `MonsterIndex`, `staticMonsterIndex`), `packages/engine/src/testing/index.ts` (`makeTestMonsterIndex`), `packages/srd/src/loader.ts`, `packages/mcp/src/stdio.ts`.
- Status: active

## 377.2 `source` is `{ book, page? }`; a book tag is lower-case `[a-z0-9-]`, with a dot only in the reserved `srd` tags

- Decided by: maintainer, 2026-11-11, epic #376 body (the shape and `{ book: "srd-5.2" }`); epic #376 orchestrator, 2026-11-14, plan gate, on the spec-auditor's proposal, not human-approved (the pattern).
- Context: The SRD's own tag `srd-5.2` has a dot, which the ticket's "letters, digits and hyphens" excludes. Stored keys are `<book>_<slug>` with one `_` and `[a-z0-9-]` on each side (#381, #385).
- Options:
  - Chosen: `^(?:srd[a-z0-9.-]*|[a-z0-9][a-z0-9-]*)$`; a dot only in tags that start with `srd`, which are reserved for built-in data, so no stored key holds a dot. #381 and #385 reuse the schema's check.
  - A dot in every tag, with #381 and #385 refusing dotted books: one rule split over two tickets.
  - Rename the SRD tag `srd-5-2`: breaks the 345.5 alias line and every SRD reply.
  - A literal `srd-5.2` exception: a special case in the schema.
- Where: `packages/engine/src/monsters/schema.ts` (`monsterSchema` `source`), `packages/srd/data/srd-5.2/monsters.json`, `packages/srd/src/map-open5e.ts`, `fixtures/test-book/creatures.json`.
- Revisit if: a built-in data set needs a tag that does not start with `srd`, or a DM's book tag needs a dot.
- Status: active

## 377.3 `search_monsters` shows the book in its text and keeps the whole source object in its structured results

- Decided by: epic #376 orchestrator, 2026-11-14, plan gate (spec-auditor cut), not human-approved.
- Context: The ticket asked for the book and page in the source column. No monster has a page before #385, and the sibling tickets want pages in `get_statblock` (#385) and `list_creatures` (#386).
- Options:
  - Chosen: the text shows `source.book` only; structured `results[].source` carries `{ book, page? }` as stored, which the model reads.
  - Book and page in the text (`homebrew p. 3`): a formatting helper and a test for a case no data has yet.
- Where: `packages/mcp/src/tools.ts` (`search_monsters`).
- Revisit if: the DM needs pages in search replies.
- Status: active
