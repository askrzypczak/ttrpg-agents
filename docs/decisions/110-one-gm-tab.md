# feature: the bridge serves one GM tab at a time (newest connection wins)

Issue: [#110](https://github.com/askrzypczak/ttrpg-agents/issues/110). Recorded retroactively on 2026-10-25 (#236).

## 110.1 One machine and one Owlbear GM tab: the bridge keeps one authenticated extension client, and the newest connection wins

- Decided by: maintainer, 2026-10-19, recorded retroactively from #110 (decided in the architecture review behind #94; built by #110, PR #154).
- Context: The bridge broadcast to every authenticated client, so two GM tabs raced in the encounter sync (duplicate tokens, "Encounter sync failed", placement per viewport), and the command channel (#98) needed one client to answer the agent's queries.
- Options:
  - Chosen: the bridge, the MCP server and the browser run on one machine with one GM tab. The bridge keeps the newest authenticated extension client and closes the older one with a fatal `superseded` error; the displaced tab stops reconnecting and shows "Connected in another tab." with a "Use this tab" button.
  - Any number of clients, all sent every message (the status quo): lost to the races above (#110).
  - A displaced tab that keeps reconnecting: "two open tabs would keep displacing each other" (#110).
  - Support several GM tabs or several GMs: "not supported, and not planned" (#94, #110); the tool serves one DM, and one client keeps the bridge and the command channel simple (one client to relay to).
  - The oldest connection wins (reconstructed; #110 gives only the reason for the newest): a reloaded tab could be locked out by its own earlier connection.
- Where: `FATAL_ERROR_CODES` and the `rejectAndClose(active, "superseded", ...)` call in `packages/bridge/src/server.ts`; `RejectionCode` in `packages/owlbear/src/reconnecting-socket.ts`; the `superseded` view with action `use-this-tab` in `panelView` (`packages/owlbear/src/panel-state.ts`); `#use-this-tab` in `packages/owlbear/index.html`; `CLAUDE.md` (Conventions).
- Revisit if: several GMs, or one GM with several tabs or machines at once, becomes a supported setup.
- Status: active
