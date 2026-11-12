# docs: decisions from the roadmap conversation after Epic K

PR: [#357](https://github.com/askrzypczak/ttrpg-agents/pull/357). No ticket: the maintainer made these decisions in a roadmap conversation with the orchestrator on 2026-11-11, before the roadmap's epics were filed, and asked for them to be logged by a PR of their own. Each epic's file records what its own plan decides.

## 357.1 The destination is an agent that runs the game, reached in three layers, with autonomy built on top of the tooling and not into it

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The README and `CLAUDE.md` describe DM-assist tooling, and the architecture pages record the structure (129.1) but not where the project is going. After Epic K the encounter-setup assistant works at the maintainer's table: it can quickly spawn a standard monster when a session goes somewhere unplanned.
- Options:
  - Chosen: three layers. First, tooling: an MCP server and engine complete enough for an agent to run a D&D game (maybe any TTRPG system later). Second, the human-directed assistant, which is the iterative path and a goal in itself. Third, later, skills and an agentic architecture that run parts of the game autonomously and eventually all of it, built on top of the assistant tooling.
  - Build autonomous game-running into the tooling directly: the maintainer wants it layered on top, so the assistant stays usable and testable without it.
  - Keep the scope at DM assistance, as it was up to Epic K: the assistant stays a goal, but it is no longer the limit.
- Where: no code yet; the roadmap's epics will cite this entry.
- Revisit if: the autonomy layer is started and needs something only an autonomous agent could use.
- Status: active

## 357.2 Owlbear stays one connector behind the engine's ports; positions may always assume a grid, and theatre of the mind is not a priority

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The maintainer described the next step as "full Owlbear control". He expects to change VTTs, so the separation of the engine from Owlbear (129.1, `TablePort`) is deliberate and stays.
- Options:
  - Chosen: "full Owlbear control" means the game-state features in the engine plus the connector work that makes them live at the table. The short-term goal is to be able to change anything related to game state in Owlbear during a live game, human directed: for example custom characters with their own art and stat sheets made through a conversation with a skill, moving characters to target others, measuring range and understanding line of sight. Positions may always assume a grid.
  - Scope the work by Owlbear's surface (fog, drawings, lights, scenes as such): the goal is game state, not every Owlbear feature.
  - Make theatre of the mind a requirement (positions optional, abstract zones): it is a possibility only, not a priority.
- Where: `CLAUDE.md` (Architecture); `TablePort` (`packages/engine/src/table/port.ts`).
- Revisit if: a second VTT is chosen, or play without a grid becomes a goal.
- Status: active

## 357.3 Preparing an encounter comes before running combat, and a monster's individual actions before turn flow

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The orchestrator first proposed one combat round as the next slice (player characters, turn tracking, positions, reveal, rolls).
- Options:
  - Chosen: prep first (custom creatures, token art, prepared encounters), then monster control at the table (positions and range, movement and reveal, action rolls, conditions, line of sight). Turn flow is parked.
  - A combat round first: the maintainer finds preparing an encounter ahead of time more valuable than running combat.
  - Turn flow (current turn, rounds) with the first table epics: not needed now; the individual actions that make up what a monster can do matter more.
- Where: no code yet; the roadmap's epic order.
- Revisit if: the autonomy layer's first step (running the monsters' turns) is started, which needs turn flow.
- Status: active

## 357.4 Player characters stay out of the model; a player's character is a named token

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The model holds monsters only. At the maintainer's table the players manage their characters in D&D Beyond, not in Owlbear.
- Options:
  - Chosen: the roadmap covers monster control. A player's character is a named token that tools can refer to ("how far is goblin 2 from Thorin?"). A separate, deliberately small epic may bring player state in through new ports and adapters: just enough for the character's Owlbear token to show live HP, AC and temp HP.
  - A party model now (name, initiative, a link to the token), as the orchestrator proposed: kept out, even though the maintainer expects that to be limiting.
  - Full character sheets in the shared state: out of scope.
- Where: no code yet.
- Revisit if: turn flow or the autonomy layer needs player characters as targets with known HP and AC.
- Status: superseded by 432.1 (the player-state epic only; player characters stay out of the model as named tokens)

## 357.5 Encounters are prepared by conversation and saved as Owlbear scenes, one encounter per scene

- Decided by: maintainer, 2026-11-11, in chat (prep by conversation first, saved in Owlbear as scenes); the reading "one encounter per scene, the active encounter switching with the open scene" was proposed by the orchestrator and confirmed by the maintainer, who added that it must keep to the hexagonal architecture.
- Context: The store holds a single active encounter, and nothing is saved or named. That one encounter follows the GM into whichever scene is open: the reconciler deletes our tokens whose instance is not in it and creates a token for each instance the scene has not placed (`planSync` in `packages/owlbear/src/sync-plan.ts`). Owlbear's SDK gives a scene no id or name, only metadata (`SceneApi`, SDK 3.1.0).
- Options:
  - Chosen: the DM opens a scene and prepares its encounter by conversation; Owlbear saves the tokens with the scene, and each scene has its own encounter, which becomes the active one when the scene is open.
  - Prepare by arranging tokens on the map and saving the arrangement: a later, separate epic for comprehensive prep.
  - Saved encounters held only in the store, with tokens created when the encounter is run (the orchestrator's first sketch): the maintainer chose scenes.
- Where: no code yet; `getOrCreateActiveEncounter` (`packages/engine/src/encounter/repository.ts`) is the single-encounter assumption this changes.
- Status: active

## 357.6 Encounter difficulty uses the 2024 DMG budget and an LLM judgement of monster count and action economy

- Decided by: maintainer, 2026-11-11, in chat.
- Context: Prep has no difficulty check. The maintainer owns the 2024 Dungeon Master's Guide and can provide its table; the repo is public, so the table is not committed unless SRD 5.2 carries it.
- Options:
  - Chosen: both the book's budget and a heuristic evaluation by the LLM of the number of monsters and the action economy. By the standing rule that the engine computes every number, the budget maths is the engine's; where the judgement lives is for the epic's plan.
  - The budget table alone: the maintainer wants more than the table.
- Where: no code yet.
- Status: active

## 357.7 Token art is tokenised locally, defaults to TooManyTokens, hosts the maintainer's own art as unlisted S3 objects, and works with no S3 configured

- Decided by: maintainer, 2026-11-11, in chat.
- Context: #289 planned a public image bucket so art needs no GM interaction, after spike #276 found that every Owlbear client fetches item images itself, anonymously and with CORS. Much of the maintainer's art will come from paid books. His players use their own laptops (357.8).
- Options:
  - Chosen: four parts. Tokenising a source image is part of the pipeline: a circle crop on the face or focal point, a frame, and transparency outside the circle. TooManyTokens art (#276, addendum) is the default wherever it covers the monster. The maintainer's own images are hosted as unlisted S3 objects, which anyone holding the URL can fetch, the same exposure as Owlbear's own asset store (#276); he accepts that as private enough for book art. With no S3 configured everything still works.
  - Cloudinary image transforms, the maintainer's first idea for tokenising, which the orchestrator extended to hosting: vendor lock-in and a fee.
  - Art served by the bridge on `localhost`: private and free, but only browsers on the GM's machine load it (#276, answer 1).
  - A private bucket with signed URLs: the links expire, and rewriting each token's URL every session is against the create-only art rule (#276, answer 5).
  - A listed public bucket as #289 was written: book art must not be listed.
- Where: no code yet; #289 is to be rewritten into the token art epic.
- Revisit if: Owlbear gains a silent upload or authenticated image loading.
- Status: active

## 357.8 Players may be remote: the shared table TV, players' own laptops and fully remote play are all supported

- Decided by: maintainer, 2026-11-11, in chat.
- Context: 110.1 fixes one machine and one GM tab and says nothing about players. The maintainer's group sits around a table-topper TV, and many players also follow on their own laptops.
- Options:
  - Chosen: players are plain Owlbear clients and may be anywhere. Anything they must see goes through the shared scene or a URL any browser can load, never the GM's machine. 110.1 stands and covers the GM's side only (bridge, MCP server, GM tab).
  - Assume every viewer is on the GM's machine: it would have allowed art served from `localhost` (357.7), and it is not the maintainer's table.
- Where: `docs/decisions/110-one-gm-tab.md` (unchanged).
- Status: active

## 357.9 A setup and configuration epic goes first

- Decided by: maintainer, 2026-11-11, in chat.
- Context: Runtime settings are six environment variables of the project's own, plus `XDG_DATA_HOME`, read in five files (`packages/store-sqlite/src/db.ts`, `packages/bridge/src/cli.ts`, `packages/bridge/src/client.ts`, `scripts/bridge.ts`, `scripts/bridge-lifecycle.ts`), with no config file, and the committed `.mcp.json` passes no environment to the MCP server. Custom art, an image host and owned-book content will each add settings.
- Options:
  - Chosen: formalise the config layer in a small foundation epic ahead of the creature and token art epics, weighing the experience of both the developer and the DM. Its contents (the orchestrator proposed one config file with environment overrides, no secrets in it, optional capabilities with stated fallbacks, one status report and one docs page) are for the epic's plan.
  - Keep adding an environment variable per feature: the MCP server has no private place for its settings, and nothing tells the DM what is switched on.
- Where: no code yet; the five files above are today's readers.
- Status: active

## 357.10 Owned-book content lives in the database, stored per feature, and is imported on demand by the agent reading PDF pages

- Decided by: maintainer, 2026-11-11, in chat (in the database, per feature, taken from his PDFs when needed); the import by the agent reading the pages, with no PDF parser, was proposed by the orchestrator and confirmed by the maintainer.
- Context: The monster index is read-only SRD 5.2 data, and the schema's `private` source is unused. The maintainer has no clear picture yet of how to support several game systems, or content that must be owned to be used.
- Options:
  - Chosen: content from books the maintainer owns goes in the database, and each feature decides how its content is stored. It is imported when needed: the agent reads the PDF pages and creates the records.
  - Content folders of files listed in the config (the orchestrator's proposal): the maintainer expects to need the database.
  - A PDF parser, or importing whole books from the start: on demand first; a whole book is the same loop run in bulk later.
  - Decide now how several game systems are supported: left open; 129.1 (the deferred split of the engine) stands.
- Where: `MONSTER_SOURCES` (`packages/engine/src/monsters/schema.ts`); `MonsterIndex` (`packages/engine/src/monsters/types.ts`).
- Revisit if: a second rule system is wanted (129.1), or on-demand import is too slow for a whole book.
- Status: active

## 357.11 After the review, scene-bound encounters come ahead of creatures and art, and every epic of the roadmap is filed in one pass

- Decided by: maintainer, 2026-11-11, in chat, approving the order the orchestrator proposed from an independent review of the plan; he then asked for every epic to be filed before the conversation ended.
- Context: The review (a subagent, run at the maintainer's request) found that the first order under-served 357.3: prepared encounters came third, behind work whose value they reduce, and the roadmap itself lived only in the conversation.
- Options:
  - Chosen: setup and configuration (#366); scene-bound encounters (#358); creature library (#376); token art pipeline (#375), with its S3 host (#289) decided once scene-bound encounters are in use; encounter difficulty (#396); saves and checks (#395); positions and range (#393); movement and reveal (#427); action rolls (#420); actions on the grid (#437); conditions and effects (#412). Player state from D&D Beyond (#432) is a separate track, and whether to build it is decided after its spike, because of D&D Beyond's terms of use. Line of sight, turn flow, a party model, comprehensive prep on the map, a session log, a second VTT connector, the autonomy layer and a database restore command are parked. The roadmap lives in #392.
  - The first order (creatures, art, then prepared encounters): preparing several encounters has no workaround today, while a custom creature has one (an SRD stand-in with its HP, AC and name changed).
  - File the first four epics now and the rest once they are in use (the orchestrator's suggestion, because later designs depend on earlier ones): the maintainer wants the whole roadmap durable now.
- Where: #392 (the roadmap issue, with the epics as sub-issues).
- Revisit if: an epic is added, reordered or parked; #392 is changed in the same piece of work.
- Status: active

## 357.12 The extension does nothing for players

- Decided by: maintainer, 2026-11-11, in chat.
- Context: Players may be remote (357.8), and the extension's page is served by the bridge on the GM's machine. Nobody has checked what a player on another device sees; the maintainer has noticed nothing odd, and his players have not tried to open it.
- Options:
  - Chosen: the extension does not need to work for players, and ideally does nothing visible for them.
  - Make the extension reachable for players, by hosting its files where their browsers can load them: not needed.
- Where: #368 (the hand check) and #373.
- Revisit if: #368 finds that players are disturbed by the page load itself, which only a public host would fix.
- Status: active

## 357.13 A process started from a git worktree uses the development database automatically

- Decided by: maintainer, 2026-11-11, in chat (yes to the orchestrator's proposal). He also said he will never start a real live session from a worktree.
- Context: Agent sessions work in worktrees, and today the MCP server and bridge they start open the maintainer's real database and run a branch's migrations on it.
- Options:
  - Chosen: a second, development profile with its own database, tokens and port, chosen automatically when the process runs from a linked worktree; an environment variable overrides it either way.
  - Choose the profile only by the environment variable: every agent session would have to set it, and one that forgot would open the real database.
- Where: #370.
- Status: active

## 357.14 The first monster added in a scene with no encounter creates the encounter at once

- Decided by: maintainer, 2026-11-11, in chat.
- Context: With one encounter per scene (357.5), a scene opened for the first time has none.
- Options:
  - Chosen: the write creates the encounter, named "Encounter N", bound to the scene, and the reply says so. It can be renamed later.
  - Ask for a name first: spawning a monster mid-session must stay one sentence.
- Where: #363.
- Status: active

## 357.15 Existing encounters are discarded when scene-bound encounters land

- Decided by: maintainer, 2026-11-11, in chat: the current system is not the source of truth of anything.
- Context: Today's single encounter and its tokens exist in the maintainer's database and scenes. The orchestrator had specified an upgrade path that kept them.
- Options:
  - Chosen: no migration and no adoption. Upgrading discards existing encounters, and old tokens left in scenes are deleted by hand.
  - The first scene opened that still holds today's tokens adopts today's encounter (the orchestrator's suggested default): extra rules in the engine, the wire and the extension to preserve data nobody needs.
- Where: #360, #361, #363, #364.
- Status: active

## 357.16 A creature the DM stored wins over an SRD monster of the same name

- Decided by: maintainer, 2026-11-11, in chat.
- Context: An imported creature can share its name with an SRD monster (the creature library, #376), and at the table the DM says only the name.
- Options:
  - Chosen: the stored creature is used and its book is named in the reply. The agent asks only when two stored creatures from different books share the name.
  - Ask each time: it costs a turn mid-session for a creature the DM imported on purpose.
- Where: #381 (the ranking), #391 (the skill rule).
- Status: active

## 357.17 The DM's own image replaces art he picked in Owlbear without asking

- Decided by: maintainer, 2026-11-11, in chat, against the orchestrator's suggested default.
- Context: Token art has three sources (357.7): a pick in Owlbear, the DM's own image set through the agent, and the TooManyTokens default.
- Options:
  - Chosen: the DM's latest explicit choice wins, whether made in Owlbear or through the agent, with no confirmation. The TooManyTokens default only fills a type that has no art.
  - A pick in Owlbear outranks art set through the agent unless the DM confirms the replacement (the suggested default): an extra question for something he has just asked for.
- Where: #378, #382, #387.
- Status: active

## 357.18 Always online is required

- Decided by: maintainer, 2026-11-11, in chat.
- Context: Default token art is fetched from the hosts that serve TooManyTokens, and the orchestrator asked whether a setting should switch that off for offline play.
- Options:
  - Chosen: a network connection is a requirement of the tool. No offline design, and no off switches for features that need the network.
  - A setting that turns the TooManyTokens default off: not wanted.
- Where: #383.
- Revisit if: the maintainer needs to run a session without a network.
- Status: active

## 357.19 Names of creatures from non-SRD books may appear in the repo; their text, numbers and art may not

- Decided by: orchestrator, 2026-11-11, proposed in chat as a default; the maintainer raised no objection; not human-approved.
- Context: The repo is public, agents write its tests and tickets, and the creature and token art epics handle content from books the maintainer owns (357.10). A rule that banned names too would make tickets about such creatures unwritable.
- Options:
  - Chosen: names may appear anywhere. Text, numbers and art may not appear anywhere an agent writes: data, fixtures, tests, docs, the decision log, tickets, comments, PR bodies, commit messages, eval files and CI artifacts. Import tests use an invented test book.
  - Ban names as well: the TooManyTokens index and many ticket titles could not be written.
  - Cover only committed data and fixtures: an agent debugging a failed import would quote the statblock in a PR or a comment.
- Where: #374.
- Status: active

## 357.20 With no GM tab open, a change goes to the encounter the DM names, else the last current one

- Decided by: orchestrator, 2026-11-11, proposed in chat as a default; the maintainer raised no objection; not human-approved.
- Context: With scene-bound encounters the open scene picks the encounter, but the MCP server also writes when no tab is open.
- Options:
  - Chosen: the encounter the DM names; otherwise the last current one. The reply names the encounter.
  - Refuse writes with no tab open: the tools work without the table today, and prep away from Owlbear would stop working.
- Where: #363, #365.
- Status: active

## 357.21 Undo of an agent move returns the token to where it stood, and a move the DM asked for raises no override note

- Decided by: orchestrator, 2026-11-11, proposed in chat as a default; the maintainer raised no objection; not human-approved.
- Context: The review found that undo of a move goes to the previous stored position, which is stale once the GM has dragged the token, and that every agent move of a dragged token adds a note to the panel (277.6).
- Options:
  - Chosen: a move records the live position it read, and undo returns there. A move that read the live position in the same command is not an override.
  - Keep today's rules: in combat, undo would send a token to a stale spot and nearly every move would add a panel note.
- Where: the movement and reveal epic; it amends 277.6 and the position row of "Who owns what" when built.
- Status: active

## 357.22 2024 statblock wording first; books in the 2014 format import as text

- Decided by: orchestrator, 2026-11-11, proposed in chat as a default; the maintainer raised no objection; not human-approved.
- Context: The engine's statblock check reads the SRD 5.2 wording. Older books word attacks differently.
- Options:
  - Chosen: the check and later roll tools parse the 2024 wording. A 2014-format entry is stored as text; only its dice expressions are listed and checked.
  - Parse both formats from the start: a second grammar before the first has been used.
- Where: #384, #388.
- Revisit if: most of the maintainer's imports turn out to be in the 2014 format.
- Status: active

## 357.23 Whether the D&D Beyond epic is built at all is decided after its spike

- Decided by: maintainer, 2026-11-11, in chat.
- Context: 357.4 allowed a small epic that shows a player's HP, AC and temp HP on their token (#432). Its writer read D&D Beyond's terms and reports that section 5.2 bans automation and extraction tools, while a 2020 staff statement called the character endpoint unsupported but not blocked.
- Options:
  - Chosen: the spike (#434) answers whether, how and under what terms the data can be read. Every building ticket stays blocked by it, and nothing is built without the maintainer's explicit yes afterwards.
  - Drop the epic now: the spike is cheap and sends nothing to D&D Beyond from the agent.
- Where: #432, #434.
- Status: superseded by 432.1 (the decision it deferred)

## 357.24 Damage from a monster's attack that hits another monster is applied at once

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The action rolls epic (#420) rolls attacks from statblock text; against a monster the engine knows the armor class and gives the verdict.
- Options:
  - Chosen: on a hit the damage is applied and the reply says so; `undo` reverses it, and a call can ask to only report. A hit on a player's token is never applied (357.4).
  - Report the damage and wait for the DM to confirm: a second step for every hit.
- Where: #423.
- Status: active

## 357.25 An attack or area out of reach or range is refused, with an override

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The actions-on-the-grid epic (#437) checks reach and range from token positions, which can lag the fiction at the table.
- Options:
  - Chosen: the tool refuses, naming the distance and the limit, and takes an explicit override.
  - Roll anyway with a warning line: a warning is easy to miss mid-session.
- Where: #442, #443.
- Status: active

## 357.26 A monster's conditions change its own rolls by the smallest rule

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The conditions epic (#412) stores conditions per monster. Their full rules need positions, sight and targets the model does not have.
- Options:
  - Chosen: only effects on the monster's own d20 rolls that need no position, sight or target are applied, and the DM can switch that off per call.
  - Conditions are only shown, and the DM always states advantage or disadvantage: the engine would know a monster is Poisoned and roll as if it were not.
  - The full rules: not possible before positions, sight and targets exist.
- Where: #418.
- Status: active

## 357.27 The agent rolls bare dice expressions the DM asks for

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The saves and checks epic (#395) adds a general roll tool; its audit asked whether a bare "roll 8d6" is wanted at all.
- Options:
  - Chosen: yes, through a `roll_dice` tool, so no number passes through the model.
  - Cut the tool: an ad-hoc roll would have no engine path.
- Where: #399.
- Status: active

## 357.28 A move to a taken cell is refused

- Decided by: maintainer, 2026-11-11, in chat, against the orchestrator's suggested default.
- Context: The movement epic (#427) lets the DM name a destination cell.
- Options:
  - Chosen: when the cell asked for is occupied, the move is refused and the refusal names the occupant; no other cell is picked.
  - Use the nearest free cells and say so (the suggested default): the token would end up somewhere the DM did not ask for.
- Where: #429.
- Status: active

## 357.29 Distance for a large token is measured from its nearest occupied square

- Decided by: maintainer, 2026-11-11, in chat.
- Context: The positions epic (#393) measures distance between tokens; Owlbear's ruler dragged from a token starts at its centre.
- Options:
  - Chosen: from the nearest occupied squares of each token, the D&D rule. Both options agree for Medium and smaller tokens.
  - From token centre to token centre: a Large monster would read as five feet farther than the rules say.
- Where: #397, #406.
- Status: active
