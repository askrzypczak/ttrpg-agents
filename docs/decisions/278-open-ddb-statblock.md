# feature: open a monster's D&D Beyond 2024 statblock page in the browser

Issue: [#278](https://github.com/askrzypczak/ttrpg-agents/issues/278).

## 278.1 The D&D Beyond URL comes from a committed table of monster key to `<id>-<slug>`, harvested from D&D Beyond

- Decided by: maintainer, 2026-11-11 (harvested the ids and checked the live site, issue comments); storing the `<id>-<slug>` segment rather than the id alone is the work-ticket orchestrator's, 2026-11-11, plan gate (approved at sign-off).
- Context: D&D Beyond does not document its URLs. The maintainer found, logged in with an account that owns the 2024 Monster Manual: a slug-only URL lands on the 2014 entry; `/monsters/5194867` and `/monsters/5194867-wrong-name` both 404, so the slug is required; `5194867-aboleth` is Monster Manual pg. 12 (2024, Initiative line) while `16762-aboleth` is Basic Rules (2014); `5195050-goblin-warrior` is Monster Manual pg. 142. Logged-out behaviour was not checked. The container cannot reach dndbeyond.com.
- Options:
  - Chosen: `packages/srd/data/srd-5.2/dndbeyond.json`, monster key to the path segment after `/monsters/`, 330 entries generated from the maintainer's key-to-id table as `<id>-<key without "srd-2024_">` (that suffix is D&D Beyond's slug for all 330: 329 matched on the Free Rules creature page, Warhorse Skeleton by search).
  - Key to id, slug derived from the key or the name: a rule that only happens to match today; a renamed display name would change the URL into a 404.
  - A filtered D&D Beyond search URL: no table, but it lands on a results list, possibly with 2014 entries, not on the page.
- Where: `packages/srd/data/srd-5.2/dndbeyond.json`; `dndBeyondUrl` (`packages/engine/src/monsters/dndbeyond.ts`).
- Revisit if: D&D Beyond changes its monster URLs, or the snapshot moves to a later SRD; re-harvest from the Free Rules creature page (commands in the issue).
- Status: active

## 278.2 The table reaches the engine through a required `MonsterIndex.dndBeyondPages`, loaded by `loadDndBeyondPages`

- Decided by: work-ticket orchestrator, 2026-11-11, plan gate (approved at sign-off), following 345.1.
- Context: the ticket puts the URL rule in the engine (no I/O) and the table with the data.
- Options:
  - Chosen: `loadDndBeyondPages(file, index)` in `srd` validates the file (an object; every key in the snapshot; every value `<digits>-<lowercase words>`) and sets the required `MonsterIndex.dndBeyondPages`; `loadMonsters` returns an empty map; `loadSrdMonsters()` adds the pages after the aliases.
  - Optional field: no edits to the six hand-built test indexes, but every reader handles a missing map (rejected for aliases in 345.1).
  - Table hard-coded in the engine: no file, but monster data would bypass the port.
  - A separate `ToolContext` field: one more wiring in `stdio.ts` and 19 test contexts, for data about monsters.
- Where: `MonsterIndex` (`packages/engine/src/monsters/types.ts`); `loadDndBeyondPages`, `loadMonsters`, `loadSrdMonsters` (`packages/srd/src/loader.ts`).
- Status: active

## 278.3 A monster without a 2024 page gets no URL; the tool says so and points to `get_statblock`

- Decided by: maintainer, 2026-11-11 (Giant Fly left out of the table: D&D Beyond search found only `27750-giant-fly`, Dungeon Master's Guide, edition unclear; the ticket: "nothing for one without a page"); the reply is the work-ticket orchestrator's, 2026-11-11, plan gate (approved at sign-off).
- Context: the ticket asked for the fallback to be recorded. Giant Fly is the one SRD monster without a page.
- Options:
  - Chosen: no entry, so `dndBeyondUrl` gives nothing and `open_statblock` replies "Giant Fly has no D&D Beyond 2024 page. Use get_statblock for its statblock." without opening anything. A test lists Giant Fly as the deliberate exception.
  - The DMG page `27750-giant-fly`: likely the 2014 entry, which the ticket rules out.
  - A D&D Beyond search URL as a fallback: a results page the DM still has to click through.
- Where: `open_statblock` (`packages/mcp/src/tools.ts`); `packages/srd/src/loader.integration.test.ts`.
- Status: active

## 278.4 The browser is opened with macOS `open` only; other platforms refuse and the reply still carries the link

- Decided by: maintainer, 2026-11-11, plan-gate question (options: Mac only; macOS, Linux and Windows as the ticket says).
- Context: the supported setup is one machine, the maintainer's Mac. A generic Linux `xdg-open` can block for the browser's lifetime, which would have needed a grace timer.
- Options:
  - Chosen: `createSystemBrowser` runs `open <url>` (no shell, the URL as one argument) on `darwin` and succeeds when it exits 0; elsewhere it rejects with "no browser opener for <platform>".
  - All three openers (`open`, `xdg-open`, `cmd /c start ""`) with a 1 s grace for a blocking opener: about 25 more lines and three more tests for platforms nobody runs.
- Where: `createSystemBrowser` (`packages/mcp/src/system-browser.ts`).
- Revisit if: the MCP server runs on a Linux or Windows desktop.
- Status: active

## 278.5 The opener takes a `platform` parameter so Linux CI tests the `open` path

- Decided by: maintainer, 2026-11-11, plan-gate question (options: keep a `platform` parameter; Mac-only tests skipped in CI).
- Context: CI and the agent container are Linux, where the Mac-only adapter refuses.
- Options:
  - Chosen: `createSystemBrowser(platform = process.platform)`; production uses the default, tests pass `darwin` with a fake `open` on `PATH`.
  - `it.runIf(darwin)` tests: no parameter, but CI never checks argument passing or failure reporting.
- Where: `createSystemBrowser` (`packages/mcp/src/system-browser.ts`); `packages/mcp/src/system-browser.integration.test.ts`.
- Status: active

## 278.6 A failed browser launch is a normal reply with the link, not an error result

- Decided by: maintainer (the ticket: the tool returns the URL "so the DM can click it when the browser cannot be launched"); not `isError` is the work-ticket orchestrator's, 2026-11-11, plan gate (approved at sign-off).
- Options:
  - Chosen: "Could not open a browser (<reason>). D&D Beyond page for <Name>: <url>", with `opened: false` in the structured content.
  - An `isError` result carrying the link: the agent may treat the call as failed and drop the link.
- Where: `open_statblock` (`packages/mcp/src/tools.ts`).
- Status: active

## 278.7 The login requirement is documented in the tool description, the mcp README and the skill, not in every reply

- Decided by: maintainer, 2026-11-11 ("document that this requires a valid dndbeyond login"); the places are the work-ticket orchestrator's, 2026-11-11, plan gate (approved at sign-off).
- Options:
  - Chosen: "The page needs a D&D Beyond login that owns the 2024 Monster Manual." in the `open_statblock` description, `packages/mcp/README.md` and the `dm-encounter` skill.
  - A note in every reply: repeated at the table on every call.
- Where: `open_statblock` (`packages/mcp/src/tools.ts`); `packages/mcp/README.md`; `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 278.8 The new skill rule gets one prompt eval

- Decided by: maintainer, 2026-11-11, plan-gate question (options: add one row; no row), following 345.6.
- Options:
  - Chosen: `EVALS.md` row 43, "open the aboleth's statblock": ONE `open_statblock`, no `get_statblock`, the link relayed.
  - No row: nothing checks that the agent picks `open_statblock` when the DM asks for the page.
- Where: `.claude/skills/dm-encounter/EVALS.md`, `.claude/skills/dm-encounter/SKILL.md`.
- Status: active
