# Epic M: scene-bound encounters

Issue: [#358](https://github.com/askrzypczak/ttrpg-agents/issues/358). Decisions that belong to no single child of the epic, made during the epic #358 orchestrator's run. Each child's own file records the decisions made for that child.

## 358.1 A reply's text names the encounter only when it matters; the structured content always carries it

- Decided by: maintainer, 2026-11-13, in chat with the epic #358 orchestrator (the epic body's open question 1).
- Context: With several encounters a reply must say which one it changed, but at the table most commands act on the open scene's encounter and the reply should stay one line.
- Options:
  - Chosen: the text names the encounter when no scene is open, when the command named an encounter other than the open scene's, or when the command created the encounter. The name is always in the reply's structured content.
  - Always in the text: a line on every routine reply at the table.
  - Never in the text: the skill decides when to say it, and may drop the name when it matters.
- Where: #365 (`packages/mcp/src/tools.ts`, the `dm-encounter` skill).
- Status: active

## 358.2 A duplicated scene shares its original's encounter; the scene id is minted once and never re-minted automatically

- Decided by: maintainer, 2026-11-13, in chat with the epic #358 orchestrator (the epic body's open question 2), on spike #359's findings.
- Context: Owlbear's "Duplicate scene" copies the scene metadata, including `com.ttrpg-agents/scene-id`, and keeps every item id; scenes have no export or import, and a scene opened in another room is the same live scene. A copy cannot be told from its original by anything in the scene (spike #359, answers 1 to 5).
- Options:
  - Chosen: the copy reports the same scene id and shares the encounter, so both scenes show the same monsters. #364 mints the id once when absent (on scene ready, and on startup with a scene already open) and never re-mints on its own; the extension README says so. The binding records no room id, because one scene is live in every room.
  - A detectable copy starts unbound (the epic's first suggested default): no copy signal exists.
  - The copy gets a copied encounter: no automatic trigger exists, and copying an encounter is out of the epic's scope.
- Where: #364 (`packages/owlbear/src/main.ts`, `packages/owlbear/src/encounter-sync.ts`, `packages/owlbear/README.md`).
- Revisit if: Owlbear gives scenes an id or a duplicate signal, or #458 (a manual re-mint action) is built.
- Status: active

## 358.3 The manual re-mint action (#458) stays outside the epic

- Decided by: maintainer, 2026-11-13, in chat with the epic #358 orchestrator (orchestrate-epic step 8).
- Context: Spike #359 filed #458, a GM panel action that gives a duplicated scene its own encounter by re-minting the scene id, blocked by #364.
- Options:
  - Chosen: a standalone ticket, not a child of the epic. The epic's out-of-scope list (unbinding a scene is a later ticket if wanted) holds.
  - A child blocked by #364: one more PR in the run for a case the maintainer rarely meets.
- Where: #458.
- Status: active
