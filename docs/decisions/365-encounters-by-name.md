# feature: the MCP addresses, lists, renames and binds encounters by name

Issue: [#365](https://github.com/askrzypczak/ttrpg-agents/issues/365). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 365.1 Every MCP tool that reads or changes an encounter takes an optional `encounter` name through `defineTool`'s `takesEncounter`; `table_status` and the tools that read no encounter take none

- Decided by: maintainer, 2026-11-11 (epic #358 body: the encounter the DM names comes first in the resolution rule). The flag, the list of 27 tools and leaving `table_status` out by the epic #358 orchestrator, 2026-11-14, plan gate (A10, approved as AC10); not human-approved.
- Context: #363's resolution rule takes a name, but no tool passed one. `table_status` belongs to #367, which never resolves an encounter.
- Options:
  - Chosen: `takesEncounter: true` on `defineTool` adds `encounter: z.string().min(1).optional()` to the input schema and passes it to `resolveEncounter` as `name`. Set on the 27 tools that resolve an encounter; not on `table_status`, `search_monsters`, `get_statblock`, `open_statblock`, `setup_status`, `propose_rooms`.
  - An `encounter` field in 27 schemas and a formatting call in 27 runs: the same behaviour repeated 27 times.
- Where: `defineTool` and the tool definitions in `packages/mcp/src/tools.ts`.
- Status: active

## 365.2 The engine says whether a reply names the encounter (`ResolvedEncounter.mention`); the MCP begins the reply with `Encounter: <name>` or `New encounter: <name>` and puts the name in structured content under `encounter`

- Decided by: maintainer, 2026-11-13 (358.1: when the text names the encounter; the structured content always carries it). The line's wording and place, error replies and the image reply by the epic #358 orchestrator, 2026-11-14, plan gate (Q1; A9, approved as AC9); the key `encounter` as a string by the epic #358 orchestrator, 2026-11-14, note during planning (shared with #367's `table_status`); not human-approved.
- Context: 358.1's condition depends on the open scene, which the resolution already reads. An adapter that read it again could disagree with the resolution and would hold a verdict (357.2).
- Options:
  - Chosen: `mention` is `created || no scene open || the open scene's encounter is not this one`, computed where the rule reads the open scene. A reply of a call that resolved its encounter, success or error, starts with `New encounter: <name>` when the call created it, else `Encounter: <name>` when `mention`, then a blank line. Structured content, where the reply has one, gets `encounter: "<name>"`, and its `summary` is the decorated text. `get_map_image`'s image reply and error replies get the line only.
  - The line last: undo's last line ("the next undo") would no longer be last.
  - Successes only: a failed `add_monsters` that created and bound an encounter would not say so.
  - `New encounter for this scene: <name>` in a scene: one more field from the engine for the same fact.
  - The MCP reads the open scene itself: a second read and a verdict in an adapter.
- Where: `ResolvedEncounter` and `resolveEncounter` in `packages/engine/src/encounter/directory.ts`; `defineTool` in `packages/mcp/src/tools.ts`.
- Status: active

## 365.3 The directory port gains `setEncounterName` and `findSceneOfEncounter`; `Encounter` does not carry its scene

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (Q4; spec audit for the dropped unknown-id contract); not human-approved.
- Context: Renaming needs a write, and listing and binding need to know whether an encounter has a scene.
- Options:
  - Chosen: two port methods. `setEncounterName` does no row-count check (its one caller passes a resolved id), and the store's unique index stays a backstop. `findSceneOfEncounter` returns the bound scene id or undefined.
  - `Encounter.sceneId: string | null`: every `Encounter` literal and `toEqual` in five test files changes, and `createUnderLock` would return a stale object after binding.
- Where: `EncounterDirectory` in `packages/engine/src/encounter/directory.ts`; `SqliteEncounterDirectory` in `packages/store-sqlite/src/sqlite-directory.ts`.
- Status: active

## 365.4 Encounter names are unique ignoring case as `toLowerCase()` folds it, checked in the engine under the write lock; empty names are refused; `InvalidNameError` is reused

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (AC5 reworded); not human-approved. Resolving before the transaction that checks and renames by the implementer, 2026-11-14, implementation; not human-approved.
- Context: 361.1 left wider case folding to this ticket ("Revisit if: #365 accepts DM-given names that differ only in non-ASCII case"). The store's `NOCASE` index folds ASCII letters only.
- Options:
  - Chosen: `renameEncounter` trims the name, refuses an empty one before resolving (so nothing is created), resolves the encounter with the read form, then, in one `directory.transaction`, refuses a name another encounter has under `toLowerCase()` (the encounter's own name is excluded, so a change of case is allowed) and renames. The `NOCASE` index stays as a backstop; no migration. `InvalidNameError` (already a display-name refusal) covers both.
  - One transaction around the resolution too: the read form's reads would take the write lock, which 363.3 keeps them off; resolving creates an encounter only with no scene open and none current (in practice an empty store), and every encounter tool keeps an encounter it created when its command then fails (363.3).
  - Fold in the store: a migration for a check the engine already makes, as `nextEncounterName` and the name lookup do.
  - A new error class: two classes for one kind of refusal.
- Where: `renameEncounter` in `packages/engine/src/encounter/directory.ts`; `InvalidNameError` in `packages/engine/src/encounter/errors.ts`.
- Status: active

## 365.5 `use_encounter` binds a named, unbound encounter to the open, unbound scene and makes it current, in one transaction; every other case is refused with `SceneBindingError`

- Decided by: maintainer, 2026-11-11 (epic #358 body: one-to-one bindings; unbinding and moving a binding are out of scope; the ticket lists the refusals). Refusing the open scene's own encounter, one error class and making it current by the epic #358 orchestrator, 2026-11-14, plan gate (Q3); not human-approved.
- Context: An encounter created with no scene open (rule 4) has no scene until something binds it. `bindScene` throws plain errors (#363) that no tool reached.
- Options:
  - Chosen: one transaction checks, in order: a scene is open; the name is known (`UnknownEncounterError`); the open scene has no encounter, its own included ("This scene already has an encounter: <name>."); the encounter has no other scene. Then it binds and makes the encounter current, so it stays the last current one when the scene closes (357.20). The three refusals share `SceneBindingError` (`scene_binding`); the MCP reads only the message.
  - Succeed with no change when the open scene already has the named encounter: a result field, a reply variant and a test, and behaviour beyond the ticket.
  - One error class per refusal: three classes the MCP treats alike.
- Where: `useEncounter` in `packages/engine/src/encounter/directory.ts`; `SceneBindingError` in `packages/engine/src/encounter/errors.ts`; `use_encounter` in `packages/mcp/src/tools.ts`.
- Status: active

## 365.6 `list_encounters` shows each encounter's name, live monster count, scene (open, another, none) and whether it is current, plus whether a scene is open; it reads outside a transaction and creates nothing

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (AC4 reworded; planner's calls confirmed); not human-approved.
- Context: The DM needs to see the encounters to name one, with no tab open or before binding one.
- Options:
  - Chosen: the engine's `listEncounterSummaries` returns every encounter oldest first with its count (removed monsters not counted), `bound`, `openScene` and `current`, plus `sceneOpen`. Reads only, outside a transaction, as 361.8 and 363.3 keep reads off the write lock. The tool shows a table and one line on the scene.
  - Read inside a transaction: every listing takes the write lock for a view that may change a moment later anyway.
- Where: `listEncounterSummaries` in `packages/engine/src/encounter/directory.ts`; `list_encounters` in `packages/mcp/src/tools.ts`.
- Status: active

## 365.7 `rename_encounter` resolves with the read form and writes no change-log event; `rename_encounter` and `use_encounter` leave an undo barrier

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate (A12, approved as AC12; planner's calls confirmed); not human-approved. The barrier follows 283.6 and 311.4 (epic #280 orchestrator; not human-approved).
- Context: Undo does not cover names or bindings. "Undo that" said right after either must not reverse the encounter change before it, which after `use_encounter` is the newly bound encounter's last change and may be old. The poll's scope check carries a rename or a binding to the panel (364.7), so no event is needed.
- Options:
  - Chosen: after the use case, the tool notes a command with no instances on the encounter (`noteCommand`), as `use_map` does; `undo` then says the last change is not covered and changes nothing. On an empty store with no scene open, `rename_encounter` creates "Encounter 1" and renames it, as every encounter tool creates one there (rule 4).
  - No barrier: undo silently reverses the change before the rename or binding.
  - A change-log event for a rename: nothing reads it; the poll already sends a fresh snapshot.
- Where: `rename_encounter` and `use_encounter` in `packages/mcp/src/tools.ts`; `renameEncounter` in `packages/engine/src/encounter/directory.ts`.
- Status: active

## 365.8 The `use_map` description names the encounter the call acts on

- Decided by: epic #358 orchestrator, 2026-11-14, plan gate; not human-approved.
- Context: 362.6 made the description say "the current encounter's map", to be revisited when `use_map` could name an encounter. It now can, and with a scene open the encounter acted on is the scene's, which may not be the current one.
- Options:
  - Chosen: "... and makes it the map of the encounter the call acts on."
  - Keep "the current encounter's map": wrong when `encounter` names another one in an open scene.
- Where: `useMapTool` in `packages/mcp/src/tools.ts`.
- Status: active
- Supersedes: 362.6
