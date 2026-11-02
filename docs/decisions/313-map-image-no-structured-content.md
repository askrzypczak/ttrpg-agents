# bug: get_map_image's image may not reach the agent when its result also carries structured content

Issue: [#313](https://github.com/askrzypczak/ttrpg-agents/issues/313).

## 313.1 get_map_image returns no structured content

- Decided by: maintainer, 2026-10-31, gate answer relayed by the epic #326 orchestrator (build the fix now; right under every outcome of the check).
- Context: Claude Code forwards only `structuredContent` to the model when a result has both it and a text block (2026-10-26 observations, 311.1, 310.9). `get_map_image` is not built with `ok`, so 311.1's `summary` never reached it. This extends 311.1 with an exception.
- Options:
  - Chosen: drop `structuredContent`. The text line already holds the map name, grid size and moved line.
  - Keep `structuredContent` and add `summary` as `ok` does: rejected, the text already says it all, and a client that forwards only structured content would still lose the image.
  - Wait for the Mac check before fixing: rejected, the fix is right under every outcome.
- Where: `getMapImageTool` in `packages/mcp/src/tools.ts`.
- Revisit if: the maintainer's before-check shows Claude Code forwarding content blocks next to structured content, or a client needs the map's item id or pixel size as data.
- Status: active

## 313.2 The dm-encounter skill states how this tool's result arrives

- Decided by: epic #326 orchestrator, 2026-10-31, spec-audit note the maintainer attached to the epic; not human-approved.
- Context: the skill said every tool's lines arrive as `summary`, which is no longer true for this tool.
- Options:
  - Chosen: state the exception in the intro and in Proposing rooms.
- Where: `.claude/skills/dm-encounter/SKILL.md` (intro, Proposing rooms).
- Status: active
