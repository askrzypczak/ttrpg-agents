# chore: cut docs/architecture.md and the owlbear README back to current rules

Issue: [#319](https://github.com/askrzypczak/ttrpg-agents/issues/319).

## 319.1 The architecture page holds the runtime view and the sync rules, the package READMEs the mechanics, and the decision log the history

- Decided by: maintainer (the trim, in chat, 2026-10-27); the split between the pages by the orchestrator at the ticket, 2026-10-27, not human-approved.
- Context: `docs/architecture.md` (5,666 words) and `packages/owlbear/README.md` (5,444 words) described the same sync behaviour in parallel, in paragraphs that each ticket extended by a clause (one bullet of 5,500 characters, one paragraph of 24,000), and the architecture page listed "In force (#N)" history that the decision log already held (206.1, 206.2, 283.1, 283.2).
- Options:
  - Chosen: `docs/architecture.md` keeps the processes, ports, auth and data flow, the rules under "What reaches the table", the "Who owns what" table and "Change origin", each rule a short bullet with a pointer. The owlbear README's "Encounter sync" becomes subsections by mechanism (desired state, planner, projectors, table edits, outbox, position, deletion, token art, redraws). Query payloads, timeouts and error codes, the image GET route and the `map-rooms` push move to the bridge README; the map rooms and undo tables to the store README. The "In force (#N)" lines go, and the one rule whose rationale the log lacked, the settle delay, gets a retroactive entry (177.1).
  - One page for the sync, dropping the rules from the architecture page: `CLAUDE.md` names that page as the runtime view and the home of "Who owns what", and a reader of the rules should not need the module names.
  - Leave both pages and only wrap the long paragraphs: the drift between them, and the history in a rule page, would stay.
- Where: `docs/architecture.md`; `packages/owlbear/README.md` (Encounter sync); `packages/bridge/README.md` (Queries, Token images); `packages/store-sqlite/README.md`; `docs/decisions/177-settle-table-edits.md`; `docs/reviewing.md` (section 6).
- Status: active

## 319.2 A prose block in a rule page is at most 1,000 characters, enforced by a test

- Decided by: orchestrator at the ticket, 2026-10-27, not human-approved; the maintainer asked for the pages to stop growing (2026-10-27).
- Context: the pages grew by accretion because nothing stopped a ticket from appending a clause to the paragraph that covered its area.
- Options:
  - Chosen: `scripts/docs.test.ts` fails `npm run check` when a prose block (consecutive non-blank lines outside code fences, headings and tables; a list item is its own block) in the root README, `scripts/README.md`, `docs/*.md` or a package README exceeds 1,000 characters. `docs/decisions/` is exempt: an entry is written once and holds its options at length. A ticket that hits the limit splits the section or shortens it. `CLAUDE.md` is exempt too: it is the maintainer's file and already asks to be kept short.
  - A word budget per page: easier to meet by packing, and it says nothing about where to cut.
  - A review rule only (`docs/reviewing.md`): the pages grew under review already.
- Where: `MAX_BLOCK_CHARS`, `proseBlocks`, `PAGES` (`scripts/docs.test.ts`); `docs/reviewing.md` (section 6); `CLAUDE.md` (PRs and reviews).
- Revisit if: the limit forces a rule into fragments that read worse than one paragraph, or a page that is not a rule page (a how-to) keeps failing it.
- Status: active
