# Epic N: creature library

Epic [#376](https://github.com/askrzypczak/ttrpg-agents/issues/376). Decisions that belong to the epic as a whole rather than to one child; the children's own files are `377-monster-index-port.md`, `381-creature-repository.md`, `384-statblock-check.md`, `385-create-creature.md` and `386-edit-remove-list-creatures.md`.

## 376.1 Creatures come from the DM's conversation or a statblock the DM provides as text; no import from PDFs or photos is built

- Decided by: maintainer, 2026-11-17, in chat with the epic #376 orchestrator.
- Context: 357.10 planned import "by the agent reading PDF pages", and spike #388 was to test that loop on the maintainer's PDFs. The maintainer owns physical copies of his books, not PDFs, so the common case has no PDF, and he does not want a photo-reading path built either. Nothing in the epic depends on where a statblock's text comes from: `create_creature` takes the statblock from the host agent and the engine checks it.
- Options:
  - Chosen: the agent creates a creature from what the DM says (invent, or clone and change an existing one) or from a statblock the DM pastes, types or points at as text; the `dm-prep` skill (#391) covers these flows and nothing else. Spike #388 closed as not planned; no replacement spike.
  - Re-scope the spike to phone photos of a physical page, read by the host agent: a photo session for the maintainer and a skill flow for a path he does not want now.
  - Keep the PDF spike: rests on a false premise.
- Where: `.claude/skills/dm-prep/SKILL.md` (#391); issue #388 (closed); the epic body's Import paragraph.
- Revisit if: the maintainer wants statblocks read from photos or scans; the tools need no change, only a skill flow and an accuracy spike.
- Status: active
- Supersedes: 357.10 (the "imported on demand by the agent reading PDF pages" half; the storage half stands)
