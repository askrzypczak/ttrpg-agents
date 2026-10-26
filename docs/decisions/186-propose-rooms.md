# feature: the agent proposes rooms from a gridded image of the map, the DM confirms

Issue: [#186](https://github.com/askrzypczak/ttrpg-agents/issues/186).

## 186.1 The ticket is split: the table read of the map image goes first as #267

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the plan's Interfaces touched six packages (protocol, owlbear, engine, bridge, mcp, and the skill). CLAUDE.md splits a plan whose Interfaces touch five or more packages into a prerequisite ticket and a feature ticket.
- Options:
  - Chosen: split. #267 took the `map-image` query, the extension's gridded render and encode, `TablePort.mapImage`, the bridge client and the 30 s wait (four packages; see 267.1). This ticket keeps `getMapImage`, `proposeRooms`, the MCP image block and tools, and the skill (two packages). The cost is two PRs and one more review cycle, as for 184.1 and 50.1.
  - One ticket with a waiver recorded here: one PR touching six packages, against an explicit CLAUDE.md rule.
- Where: #267; this ticket's body.
- Status: active

## 186.2 The engine shrinks proposed ranges; the agent only reads the interior from the image

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (from a spec-audit conflict), not human-approved; the rule itself (one cell on every side where the room is at least three cells wide) is the maintainer's (epic #92, 2026-10-23), and is unchanged.
- Context: the ticket's Skill section had the agent shrink each proposed range and report it to the DM ("Taproom U6:AA10"). CLAUDE.md says "New game logic goes in the engine. That includes any number or verdict the agent reports ... the engine computes it." Shrinking is arithmetic on column letters (Z to AA), where an agent can slip.
- Options:
  - Chosen: `proposeRooms(rooms)` in `room-index.ts` checks the names and ranges as `setRooms` does (its private `parseRooms`), needs no table and no store, and shrinks each range on each axis where it spans three or more cells. The read-only `propose_rooms` tool returns the proposals. Prep is `get_map_image`, `propose_rooms`, the list shown to the DM, the DM's confirmation, then one `set_rooms` with exactly the shown ranges; live is `get_map_image`, `propose_rooms`, `set_rooms` with status `proposed`, then the same `add_monsters` again. One more tool call per proposal.
  - The shrink in the skill, recorded as an exception to the rule: no code, as the ticket was written; the agent computes and reports a number.
  - `set_rooms` options `shrink` and `preview` (a dry run for prep): two modes on a destructive tool, and the DM's own corrected ranges would need a per-room flag so they are not shrunk.
- Where: `proposeRooms`, `RoomProposal` (`packages/engine/src/map/room-index.ts`), `propose_rooms` (`packages/mcp/src/tools.ts`), "Proposing rooms" in `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 186.3 In live play a room not printed on the map is not guessed

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate (proposed addition, approved), not human-approved.
- Context: the live flow proposes a room the DM names that is not saved. The ticket does not say what happens when the map does not show that room: its name is not printed, or the map's rooms are numbered and the DM has not said which number it is.
- Options:
  - Chosen: the skill relays the unknown-room error and asks the DM where the room is; it calls no `propose_rooms` or `set_rooms` and does not retry. This is the maintainer's "on a map with numbered rooms, ask the DM for the names" applied to the live flow, not a new rule. An eval row ("add 2 wolves in the throne room") checks it.
  - Guess a range anyway: a fabricated room, placed where nothing on the map says it is.
- Where: "Proposing rooms" in `.claude/skills/dm-encounter/SKILL.md`, `.claude/skills/dm-encounter/EVALS.md`.
- Status: active

## 186.4 A live proposal is saved under the DM's word

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: after the proposal is saved, the agent repeats the same `add_monsters` call, whose `room` is the DM's word. Rooms match ignoring case (185.9), but not by part of a name. The test map prints "Library and Study".
- Options:
  - Chosen: the room is named after the DM's word, capitalised ("Library" for "the library"), so the retried call matches.
  - The printed name: the retry with "library" would fail as an unknown room.
- Where: "Proposing rooms" in `.claude/skills/dm-encounter/SKILL.md`.
- Revisit if: the DM wants the printed names kept; they can rename by saving the room again under that name.
- Status: active

## 186.5 Eval row 23 now checks the live flow; the prep check is one two-turn row

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: row 23 ("add 2 wolves in the library", state rooms) asserted that an unknown room is relayed with no `set_rooms`, which the live flow replaces. The prep check needs the DM's confirmation, a second sentence.
- Options:
  - Chosen: row 23 expects the live flow (the test map prints the library). A new row runs "label the rooms", then "yes" in the same session (`claude -p --continue`), and expects no `set_rooms` before the second turn. A third new row covers 186.3.
  - Keep row 23 and add a live row with another room: two rows for one sentence shape, and row 23 would contradict the skill.
- Where: `.claude/skills/dm-encounter/EVALS.md`.
- Status: active

## 186.6 The manual check in Owlbear is deferred to the epic PR

- Decided by: epic #92 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: the ticket asks for a manual check recorded in the PR: on the test map the agent proposes rooms, the DM confirms, and `list_rooms` shows them. The sub-agent that works this ticket has no browser.
- Options:
  - Chosen: the check keeps the maintainer's wording and is listed as not run in this PR's body; the epic #92 orchestrator carries it into the epic PR's manual checks, as 50.11.
  - Run it before this PR is integrated: needs a person with the Owlbear test room open.
- Where: this PR's body; the epic #92 PR.
- Status: active

## 186.7 The agent reads each arm of an L-shaped room as a full rectangle; the engine keeps shrinking each range on its own

- Decided by: epic #92 orchestrator, 2026-10-25, review round 1 (raised by the reviewer), not human-approved.
- Context: the maintainer's rule shrinks a proposed room "by one cell on every side where the room is at least three cells wide". `proposeRooms` applies it to each range of a room separately (the approved contract pins it: `proposeRooms` tests in `room-index.test.ts`, `propose_rooms` in `rooms.integration.test.ts`). An L-shaped room read as `T5:AB11` and `T12:V14` would become `U6:AA10` and `U13`: the edge where the two ranges meet is shrunk too, and the proposal has a gap (rows 11 and 12 of the arm).
- Options:
  - Chosen: the engine keeps the per-range shrink (the rule speaks of ranges, and the contract pins it), and the skill tells the agent how to read an L so the shrink does no harm: each arm is a full rectangle that runs to the room's outer walls, so the arms overlap where they meet (`T5:AB11` and `T5:V14`, not `T5:AB11` and `T12:V14`). The shrunk arms then still touch (`U6:AA10`, `U6:U13`). Skill wording only; no engine or test change.
  - Engine: skip shrinking a side a range shares with another range of the same room. Larger; changes the contract's expectations for the L-shaped case.
- Where: "Proposing rooms" in `.claude/skills/dm-encounter/SKILL.md`; `proposeRooms` (`packages/engine/src/map/room-index.ts`).
- Revisit if: the maintainer reads "every side where the room is ..." as the room's outline, not each range's.
- Status: active
