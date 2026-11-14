# feature: scene bindings, the open scene and which encounter a command acts on

Issue: [#363](https://github.com/askrzypczak/ttrpg-agents/issues/363). Part of Epic M ([#358](https://github.com/askrzypczak/ttrpg-agents/issues/358)).

## 363.1 A scene binding is the column `encounters.scene_id` (unique), and the open scene a one-row table; migration 19 copies nothing

- Decided by: maintainer, 2026-11-11 (epic #358 body: a scene is a one-to-one binding to an encounter, not its key) and 2026-11-13 (358.2: no room id). The storage shape by the epic #358 orchestrator, 2026-11-13, plan gate (Q2); not human-approved.
- Context: Each scene binds at most one encounter and each encounter at most one scene. The open scene is one value that may name an unbound scene. No encounter predates migration 17, so nothing is bound and no scene is open after the upgrade.
- Options:
  - Chosen: `ALTER TABLE encounters ADD COLUMN scene_id TEXT` with `CREATE UNIQUE INDEX encounters_scene ON encounters (scene_id)`; table `open_scene (id INTEGER PRIMARY KEY CHECK (id = 1), scene_id TEXT NOT NULL)`, where no row means no scene is open. One column gives an encounter at most one scene; the unique index gives a scene at most one encounter (SQLite treats NULLs as distinct). SQLite cannot `ADD COLUMN ... UNIQUE`, hence the separate index.
  - A `scene_bindings (scene_id PRIMARY KEY, encounter_id UNIQUE REFERENCES encounters)` table: a second table and a foreign key for a one-to-one value (362.2 put the map in a column for the same reason).
  - A generic key-value table for the open scene: no second key exists.
- Where: migration 19 in `packages/store-sqlite/src/migrations.ts`; `SqliteEncounterDirectory.getOpenScene`, `setOpenScene` and `bindScene` in `packages/store-sqlite/src/sqlite-directory.ts`.
- Status: active

## 363.2 The directory port gains `getOpenScene`, `setOpenScene` and `bindScene`; the engine matches an encounter's name over `listEncounters()`, and the port has no lookup by name or by id

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (Q2); not human-approved. The #361 gate had moved "finding an encounter by name or by id" to #363; this entry reads that line as met by the engine-side match.
- Context: The rule's case 1 needs the encounter with a given name (ignoring case) and, when there is none, every name for the error. Cases 2 and 3 need the open scene's encounter.
- Options:
  - Chosen: `getOpenScene()` returns `{ sceneId, encounter }` in one read, so nothing needs a lookup by id. Case 1 matches the name with `toLowerCase()` over `listEncounters()`, which it reads anyway for the error, as `nextEncounterName` and `findRoom` do (ASCII-only uniqueness in the store, 361.1).
  - `findEncounterById` and `findEncounterByName` port methods: two methods and two store tests, and the name rule would sit partly in SQL.
  - A separate scene port: a second injection for the same database, and the rule needs both in one transaction.
- Where: `EncounterDirectory` and `OpenScene` in `packages/engine/src/encounter/directory.ts`.
- Revisit if: #365's wider case folding needs the store to match names.
- Status: active

## 363.3 `resolveEncounter(directory, { name?, writes })` picks the encounter by the four-case rule and returns whether it created it; reads run outside a transaction, creating and switching inside one with a re-read; no repository creates an encounter

- Decided by: maintainer, 2026-11-11 (epic #358 body: the four cases; a read in an unbound scene fails "This scene has no encounter yet."; 357.14 and 357.20). Signature, the created flag's shape and the transaction split by the epic #358 orchestrator, 2026-11-13, plan gate (Q4); not human-approved.
- Context: #361's `resolveEncounter(directory)` was a stopgap (361.4) that returned the current encounter or created one. Every MCP call resolves its encounter, and two processes share the database.
- Options:
  - Chosen: 1. a name gives that encounter (no scene open: it also becomes current), else `UnknownEncounterError`; 2. an open bound scene gives its encounter; 3. an open unbound scene: the write form creates "Encounter N", binds it and makes it current, the read form throws `NoSceneEncounterError`; 4. no open scene gives the current encounter, created when none is (both forms). Answers that write nothing are read outside a transaction; creating, and case 1's switch, run in `directory.transaction`, which reads the open scene, the binding and the current encounter again and decides again; the read form fails there too when another process opened an unbound scene since its first read (reviewer, review round 1), so it never creates or binds in an open scene. "In the write's transaction" is read as one transaction of its own, taken when the call first reads its encounter, so a command that fails after that keeps the new encounter. A scoped repository still logs its own id and creates no encounter (361.4's other half).
  - A write transaction on every call: every read-only tool call takes the write lock (as 361.8 found).
  - Create in the command's first store write: a pending-encounter wrapper over the 21 `EncounterRepository` and 4 `MapRepository` methods (Q1's third option).
- Where: `resolveEncounter`, `EncounterRequest` and `ResolvedEncounter` in `packages/engine/src/encounter/directory.ts`.
- Status: active
- Supersedes: 361.4, 361.8

## 363.4 `openScene(directory, sceneId | null)` records the open scene and makes its bound encounter current in one transaction; it takes no origin and writes no event

- Decided by: maintainer, 2026-11-11 (epic #358 body: the bridge calls `openScene`, which records the open scene and makes its bound encounter current). Dropping the origin parameter by the epic #358 orchestrator, 2026-11-13, plan gate (Q3; reported to the maintainer for veto); not human-approved.
- Context: The epic body and #364 say the bridge calls it "with origin `table`". It writes no change-log event and changes no instance, so an origin would be read by nothing; the table's authority over the open scene is #364's "Who owns what" row.
- Options:
  - Chosen: no origin parameter. An unbound scene or null binds nothing and leaves the current encounter.
  - `openScene(directory, sceneId, origin)` with the origin unused: a parameter nothing reads.
- Where: `openScene` in `packages/engine/src/encounter/directory.ts`.
- Revisit if: the open scene ever reaches the change log.
- Status: active

## 363.5 Only `add_monsters` and `use_map` resolve with the write form; every other MCP tool resolves with the read form

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate (Q1; reported to the maintainer for veto); not human-approved. It narrows the epic body's "a write creates" (maintainer, 2026-11-11) to the commands that can start an encounter, in line with 357.14 ("the first monster added").
- Context: In an open scene with no encounter, every other writing tool can only fail or do nothing on a new empty encounter (no targets, nothing to clear, restore or undo, no map for rooms), and the empty encounter would stay bound to the scene: this epic has no unbind or move.
- Options:
  - Chosen: `defineTool` takes an optional `startsEncounter: true`, set on `add_monsters` and `use_map`; their calls resolve with `writes: true`, every other call with `writes: false`. Both tools read the encounter before validating, so an `add_monsters` with an unknown monster key, or a `use_map` on a scene with no map, still creates and binds "Encounter N".
  - Every tool not annotated read-only creates (derived from `annotations.readOnlyHint`): `apply_damage` in a new scene would create an encounter, then refuse its unknown target.
  - Create in the command's first store write: see 363.3.
- Where: `defineTool` in `packages/mcp/src/tools.ts`; `ToolCallContext` doc comments in `packages/mcp/src/context.ts`.
- Revisit if: the maintainer vetoes Q1 (reversal: derive the form from `readOnlyHint` and drop the flag), or a later tool can start an encounter.
- Status: active

## 363.6 An unknown encounter name fails with a message that lists the known names, as `findRoom` does

- Decided by: epic #358 orchestrator, 2026-11-13, plan gate; not human-approved.
- Context: The ticket's case 1 asks for "a domain error listing the encounters' names". #365 owns reply wording.
- Options:
  - Chosen: `UnknownEncounterError` (`unknown_encounter`): `Unknown encounter "X"; known encounters: A, B.`, or `Unknown encounter "X"; there are no encounters.` when there are none.
  - A plain `DomainError` with the code: the repo has one class per refusal (`UnknownRoomError`, `UnknownInstanceError`).
- Where: `UnknownEncounterError` in `packages/engine/src/encounter/errors.ts`; `resolveEncounter` in `packages/engine/src/encounter/directory.ts`.
- Revisit if: #365 rewords the replies that name an encounter.
- Status: active
