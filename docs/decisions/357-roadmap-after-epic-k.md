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
- Status: active

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
