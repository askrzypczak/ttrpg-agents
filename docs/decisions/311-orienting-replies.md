# bug: tool replies reach the agent as raw structured data instead of an orienting summary

Issue: [#311](https://github.com/askrzypczak/ttrpg-agents/issues/311).

## 311.1 Every tool reply built with `ok` carries its text as `summary` in its structured content

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q1); not human-approved. That the reply exists to orient the agent, and that raw records are not useful, is the maintainer's (#311, 2026-10-26).
- Context: Claude Code forwards only `structuredContent` to the model when a tool returns both a text block and structured content (the epic #280 orchestrator's `list_encounter` call, 2026-10-26; corroborated by a `search_monsters` call in #311's session the same day). The reply lines (before and after, "no longer fits", what was left alone) never reached the agent, and the `dm-encounter` skill tells it to relay them verbatim.
- Options:
  - Chosen: `ok(text, structured)` returns `structuredContent: { summary: text, ...structured }` for every tool built with it. The text block stays for clients that forward text. One place covers every tool, including `apply_damage`, `heal`, `remove_monsters` and `table_status`.
  - Epic J tools only, through an opt-in on `ok`: the older tools whose lines the skill relays verbatim would stay JSON-only for the agent.
  - No structured content wherever the text says it all: per tool, inconsistent with the rest, and the data fields the tests and other clients read would be lost.
- Where: `ok` in `packages/mcp/src/tools.ts`; `.claude/skills/dm-encounter/SKILL.md` (intro).
- Revisit if: Claude Code starts forwarding the text block as well, so the agent reads every line twice.
- Status: active

## 311.2 `undo`'s structured content is a compact per-field view: `{ summary, undone, notCovered, changes, kept, next }`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (Q2, Q3); not human-approved. Compact per-change entries, and max HP kept separate from current HP, are the maintainer's (#311, 2026-10-26).
- Context: `undo` returned whole `MonsterInstance` records for each change (encounter id, creation time, spawn position), and `changes[].field` said `hp` even when max HP changed.
- Options:
  - Chosen: the same keys appear in every case. `changes` holds `{ monster, field, before, after }` per field written back, with `monster` the name after the undo:
    - `existence` is "in the encounter" or "removed".
    - `type` is the monster name.
    - The engine's `hp` change splits into `maxHp` and `hp`, each only when it differs. A type undo expands into its `type`, `name`, `maxHp`, `hp`, `armorClass` and `initiative` that differ.
    - `group` is the names of the other members before and after (`[]` means on its own).
    - `position` is the words "moved" and "moved back".

    `kept` holds `{ monster, field, reason }` for what undo left alone ("changed at the table", "removed at the table", "no earlier value"), with the engine's field name: an HP the table changed stays `hp`, not split, since the engine does not tell the table's max HP edit from its current HP edit (contract-writer). Group members are listed in encounter order. `next` is the engine's `UndoNext`.

  - Group ids as the group's before and after: opaque to the agent.
  - Spawn coordinates as the position's before and after: excluded by the ticket, and cells would need the live map.
  - No structured content for `undo`: inconsistent with 311.1.
- Where: `undoTool` and its view helpers in `packages/mcp/src/tools.ts`.
- Supersedes: 283.12
- Status: active

## 311.3 The engine reports what the next undo would reach: `UndoResult.next`

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved. That `undo` says what the next undo would reverse is the maintainer's (#311, 2026-10-26).
- Context: the next undo's target is a verdict, and the Architecture section puts verdicts in the engine.
- Options:
  - Chosen: the `not-covered` and `undone` results carry `next: UndoNext | null`. `UndoNext` is `{ command, monsters, covered }`. It is read inside the undo's transaction, after the undone command and the undo's own are forgotten. Monster names come from the live instance, else the removed one, else the name recorded before the command. `covered` is false for a record with no instances. The reply ends with "Next undo would reverse <command>: <names>." (up to five names, else a count, as in 282's cleared line), "Next undo would reach <command>, which it does not cover.", or "Nothing left to undo.".
  - The tool reads `latestUndoRecord` after the undo itself: the verdict and the name lookup would sit in the adapter.
- Where: `UndoNext`, `UndoResult`, `undoLastCommand` (`packages/engine/src/encounter/undo.ts`); `undoTool` (`packages/mcp/src/tools.ts`).
- Status: active

## 311.4 Map and room changes leave a barrier: undo says it does not cover them, changes nothing and names what the next undo would reach

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate; not human-approved. The barrier behaviour is 283.6's, unchanged.
- Context: 283.6's reply ended "say undo again to reverse the encounter change before it". With the next-undo line (311.3), that tail is wrong when nothing is left or when the next change is another map or room change.
- Options:
  - Chosen: the barrier stays as 283.6 decided (`noteCommand`, `not-covered`, forgotten without a write). The reply is "The last change was <tool>, which undo does not cover; nothing was changed." followed by the next-undo line.
  - Keep 283.6's sentence and append the next-undo line: the reply would contradict itself when nothing is left.
- Where: `undoTool` (`packages/mcp/src/tools.ts`); `.claude/skills/dm-encounter/SKILL.md` (Undoing the last change).
- Supersedes: 283.6
- Status: active
