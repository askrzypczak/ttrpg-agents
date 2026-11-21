# feature: assess_difficulty and set_party MCP tools

Issue: [#410](https://github.com/askrzypczak/ttrpg-agents/issues/410).

## 410.1 `assess_difficulty` resolves the party before the encounter, and assesses the `with` monsters alone only when the scene has no encounter

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved.
- Context: `assess_difficulty` is a read-only encounter command (#363's read form). The read form creates "Encounter 1" on an empty store with no scene open, and fails with `NoSceneEncounterError` in an open scene with no encounter. The ticket asks that `with` alone be assessable where there is no encounter.
- Options:
  - Chosen: `resolveParty` first, so a missing party fails before any encounter is resolved or created; then the read form, falling back to the `with` monsters alone only on `NoSceneEncounterError` and only when `with` has a group.
  - Encounter first: on an empty store with no scene, the call would create "Encounter 1" and then fail for a missing party.
  - Fall back on any resolution error: an unknown `encounter` name would be silently ignored and the `with` monsters assessed instead.
- Where: `assess_difficulty` in `packages/mcp/src/tools.ts`.
- Status: active

## 410.2 `set_party` notes its command in the MCP after `setParty`; a call with no number re-stores the stored party

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved.
- Context: `set_party` is not an encounter command, so `undo` right after it must say it does not cover it (385.6). `setParty` (#408) takes only the party store.
- Options:
  - Chosen: call `setParty`, then `noteCommandOnCurrentEncounter(ctx.encounters, origin)` in the tool, as `rename_encounter`, `use_encounter` and `use_map` note after their use case. On an error nothing is stored or noted. With neither number, `setParty` re-stores the stored party and the reply shows it unchanged.
  - A new engine use case taking the directory and an origin: a wider engine API for a two-line sequence.
- Where: `set_party` in `packages/mcp/src/tools.ts`. Follows 385.6 and 365.7.
- Status: active

## 410.3 Reply wording: SRD band names, counts as written, no per-character ratio in the text, CR as a fraction; structured content is the engine's assessment

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved. The cut of an override flag is a spec-auditor verdict the orchestrator accepted.
- Context: The engine computes every number and verdict (357.6); the MCP only formats. #411's prep skill reads the reply and the structured content.
- Options:
  - Chosen: band names Low, Moderate, High and "above High" (never "deadly"); a monster table with CR through the now-exported `formatCr` (1/8, 1/4, 1/2); "Monsters: n for m characters[, more than two per character]."; the per-character ratio only in structured content, so the adapter rounds no engine number; structured content is `DifficultyAssessment` as the engine returns it, plus `encounter` and `summary`. An override is shown as "for this call only" in the text.
  - A `partyOverridden` flag in structured content: no consumer.
  - Printing the ratio in the text: the adapter would have to round an engine number.
  - Printing the CR as a decimal (0.25), as `search_monsters` does: harder to read against the SRD's own notation.
- Where: `assess_difficulty` and `set_party` in `packages/mcp/src/tools.ts`; `formatCr` in `packages/mcp/src/statblock.ts`.
- Status: active

## 410.4 Party numbers in the tool schemas are `int().optional()` only: never nullable, no range

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved.
- Context: `setParty` and `resolveParty` merge with `??`, so a runtime `null` would fall back to the stored number silently. The engine checks ranges and throws `InvalidPartyError` (408.1).
- Options:
  - Chosen: `z.number().int().optional()`, with the range in `.describe()`. A JSON `null` is refused as invalid arguments; an out-of-range number reaches the engine and the DM reads its message.
  - Also `min`/`max` in zod: the JSON schema would show the range, but zod's message would replace the engine's.
  - `.nullish()`: a `null` would fall through `??` to the stored number.
- Where: `set_party` and `assess_difficulty` input schemas in `packages/mcp/src/tools.ts`.
- Status: active

## 410.5 Existing MCP test contexts build the party store with `makeTestPartyStore()` from `@ttrpg-agents/engine/testing`

- Decided by: epic #396 orchestrator, 2026-11-21, plan gate; not human-approved.
- Context: `ToolContext.party` is required, so every MCP test that builds a full context needs a `PartyStore`. None of those tests calls the new tools.
- Options:
  - Chosen: an in-memory helper, `makeTestPartyStore(party = null)`, that copies in and out, as 371.7 chose `makeTestSetupPorts` for `ToolContext.setup` and #381 added `makeTestCreatureRepository`.
  - An inline placeholder per literal: the option 371.7 rejected; one edit per literal if `PartyStore` changes.
- Where: `makeTestPartyStore` in `packages/engine/src/testing/index.ts`; the `ToolContext` literals in `packages/mcp/src/*.integration.test.ts`.
- Status: active
