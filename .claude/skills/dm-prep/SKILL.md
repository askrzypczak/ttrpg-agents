---
name: dm-prep
description: Prepare D&D creatures between sessions through the ttrpg-agents MCP tools. Use when the DM says things like "make a goblin shaman", "make a tougher goblin warrior", "add this statblock from page 52 of my Monster Manual", "here is a statblock", "create this creature", "store this monster", "change the stored goblin shaman's AC", "that's a typo, the Talons do 10", "remove the goblin shaman from my creatures", "what creatures have I stored", "show me other goblins", "use this picture for the wolf", or pastes the text of a creature's statblock.
---

# DM prep

The DM is preparing, not playing, so the conversation can be longer than at the table. Turn each sentence into the fewest correct calls to the `ttrpg-agents` MCP tools: `search_monsters`, `get_statblock`, `create_creature`, `edit_creature`, `remove_creature`, `list_creatures`; for token art, `preview_token`, `set_token_art`, `show_token_variants` and `table_status`. For monsters in an encounter, `dm-encounter` is the skill.

- The tools are the only source of truth. Never use Bash or grep, and read no file except one the DM names (Read that one file, and only to get the statblock text from it), and an image the DM names for token art (Read it only to look at it).
- Importing from PDFs or photos is not built (maintainer decision 2026-11-17). If the DM offers one, ask them to paste or type the statblock text, or name a text file that holds it.
- The creature tools take no `encounter` and never create one. `undo` does not cover them: say so if the DM asks to undo a creature change.
- Each tool's reply comes back as the `summary` of its result: "relay a line" below means copy it as it is.

## Never invent numbers

Every number comes from tool output or from the statblock text the DM provided. Never fill a field from memory, never give a "typical" value for a creature from a book, and never roll. The check in the reply reports what an entry would roll; nothing is rolled in prep.

## Inventing a creature

"Make a goblin shaman", "make a tougher goblin warrior":

- Call `search_monsters` for the base creature, unless its key is known from this session. If one match is clear, use it; if several unrelated or differently-sized matches fit, ask which one and call nothing else until the DM answers.
- Then ONE `create_creature` with `from` the base key and every change the DM named in `changes`: `name`, `ac`, `hp` as `{ dice }` (omit `average`; the engine sets it), `abilities`, `saves`, `speeds`, `senses` and `skills` (they merge by key; `null` removes a speed, sense or skill), and `sections.<section>.remove`, `.replace` or `.add`.
- `book` is `homebrew` unless the DM names another. Do not ask about the book for an invented creature.
- Use only the values the DM gave. If a change needs a number they did not give, ask for it.

## Creating a creature from a statblock the DM provides

The DM pastes or types a statblock, or names a text file that holds it ("add this statblock from page 52 of my Monster Manual"):

- ONE `create_creature` with no `from` (unless the DM says "like a goblin"), giving every required field transcribed from the text: `name`, `size`, `type`, `alignment`, `ac`, `hp` (`{ dice }`), `speeds`, `abilities`, `saves`, `initiativeModifier`, `cr` and `languages`; add `skills`, `senses`, `armorDetail` and the four lists `damageVulnerabilities`, `damageResistances`, `damageImmunities` and `conditionImmunities` when printed. Put each trait, action, bonus action, reaction and legendary action in `sections.<section>.add` as the text gives it.
- Copy every number and every entry's wording as printed, including a number that looks wrong. Never correct while transcribing: the check reports a mismatch and the DM decides.
- `book` is the DM's short tag for the book, and `page` is the page when the DM gave it. When the DM has not named a book, ask for the tag once (a short lower-case word such as `mm-2024`), call nothing until they answer, then reuse it for every creature from that book for the rest of the conversation. Ask again only for a different book. Never pass a tag starting with `srd`.
- Call no `search_monsters` first: a creature from text is new.
- Statblock text that is cut off or missing a required field: ask for the missing part; do not fill it in.
- A 2014-layout statblock prints only some saving throws and no initiative modifier, and `create_creature` needs all six `saves` and `initiativeModifier`. Derive them from the printed ability scores: an unprinted save is that ability's modifier, and initiative is the DEX modifier. Say in the reply which fields were filled that way. The check accepts both (a save may be the modifier or modifier plus proficiency).

## Reading the reply

- Relay the "Created ..." or "Edited ..." line, then the Rolls, Text only and Findings lines verbatim.
- "Text only" entries (in a 2014-layout statblock, for example) are stored as text. Say in one line that they are not checked and roll nothing yet; do not say the engine checked them.
- Findings never block: the creature is stored. Relay each finding as it is.

## Findings

- When the DM's text shows a different number from the one stored (a transcription slip), fix it with ONE `edit_creature`.
- When the stored number is the one the text prints, say the book's number is kept and make no call. The DM may be right and the book wrong.
- Never change a number to the check's expected value on your own. When the DM confirms ("that's a typo, it's 10"), make ONE `edit_creature` with `sections.<section>.replace` carrying the whole entry (same name, its wording as stored, the corrected number). Relay the reply; its Findings line should now read "none".

## Editing a creature

"Change the stored goblin shaman's AC to 14":

- Resolve the key: `<book>_<name as lower-case words joined by hyphens>`, or call `list_creatures` when unsure. Then ONE `edit_creature` with `key`, `page` only to set one (it cannot clear it) and the `changes`, as for `create_creature`.
- When the reply names monsters in encounters that keep their max HP, AC, size and name, relay that line, and offer `reset_max_hp`, `set_armor_class` or `change_monster_type` to update them. Make none of those calls unless the DM agrees.
- SRD monsters cannot be edited: offer a copy with `create_creature` and `from`.

## Removing a creature

"Remove the goblin shaman from my creatures" is ONE `remove_creature` with the key. When it is refused because monsters in an encounter use it, relay the refusal verbatim and stop: do not remove or retype those monsters unless the DM asks. SRD monsters cannot be removed.

## Listing

"What creatures have I stored?" is ONE `list_creatures`, with `book` when the DM names one. Relay the table. It lists stored creatures only, not the SRD.

## Token art

Token art belongs to a monster type, not to one monster, and the DM sets it in prep. The tools are `show_token_variants`, `set_token_art`, `preview_token` and `table_status`. None takes an `encounter` or creates one. `undo` does not cover `set_token_art`: say so if the DM asks to undo an art change.

- The default arrives by itself. When monsters of a type with no art are added (`add_monsters`, `change_monster_type`, `restore_monsters`, `restore_encounter`), the reply has a line "<Name>: token art set to the TooManyTokens default." Relay it and call nothing for it. A line "No TooManyTokens art for <Name>; the GM will be asked to pick." with a reason means the image could not be fetched: relay it as it is and make no art call; the GM picks the art in Owlbear as before. A type that already has art, or that the pack does not cover, gets no line.
- Other variants. "Show me other goblins" is ONE `show_token_variants` with `monster` (a monster key from `search_monsters` or `list_creatures`, never a name) and `page` only when the DM asks for more. It returns one contact-sheet image of up to 20 variants, numbered left to right then top to bottom, with no numbers drawn; look at it and count the cells. Relay its text line (the numbers on the sheet, the total and the current art's number). When the DM picks one ("the second one"), call ONE `set_token_art` with `monster` and `variant` set to that number, and no `image`, `focus` or `zoom` (the tool refuses them). A variant is published at once.
- The DM's own image. The DM names an absolute file path or an https URL. Read a file first to see it. Call `preview_token` with `image` and a `focus` of `{ x, y }` (fractions 0 to 1 of the width and height) on the face or subject, and `zoom` 1 to 8 to narrow the crop. Look at the token it returns, relay its crop line, and adjust `focus` or `zoom` and preview again until the DM agrees. Do not set a focus before you have looked at the image. Then call ONE `set_token_art` with the same `monster`, `image`, `focus` and `zoom`.
- Setting art replaces any art the type had, a GM pick in Owlbear included, with no confirmation question. Relay the reply's line "It replaces ..." (or "It had no art before."), which names what was replaced. When the reply says "nothing changed", relay it and do not retry.
- After the DM's own image, the reply says the art waits on the GM. Tell the DM the steps: in the extension panel, click Re-upload next to the monster, then Pick the uploaded image; until then new tokens are circles and existing ones keep their look. Call `table_status` once to see whether the art is still waiting and relay its line; if it fails, relay the error and stop (the art stays waiting). A variant needs no panel step.
- Never copy book art into the repo or into any file you write. Give `set_token_art` the DM's own path or URL as it is.

## Same names

A stored creature and an SRD monster with the same name are not a choice: use the stored one (search lists it first) and name its book. Two stored creatures from different books with the same name: use the book the DM named, otherwise ask which book and do nothing until they answer.

A name that is both a stored creature and a monster in an encounter (a stored Goblin Shaman and Goblin Shaman 1 on the table): "the stored goblin shaman" and "from my creatures" mean the creature; "goblin shaman 1" and "in the encounter" mean the monster, which is `dm-encounter`'s job. When the DM's words say neither ("make the goblin shaman AC 14", "remove the goblin shaman"), ask whether they mean the stored creature, the monster in the encounter, or both, and make no call until they answer.

## Book content

This skill and its evals hold no text from published books. Examples use SRD names and the invented test book in `fixtures/test-book/`.
