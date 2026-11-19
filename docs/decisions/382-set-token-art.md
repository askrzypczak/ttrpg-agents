# feature: `set_token_art` sets the DM's own image as a type's art, published through the Owlbear upload and pick path

Issue: [#382](https://github.com/askrzypczak/ttrpg-agents/issues/382).

## 382.1 `set_token_art` names the monster type by its monster key only

- Decided by: epic #375 orchestrator, 2026-11-19, plan gate (Q1), not human-approved.
- Context: The ticket said the tool resolves the monster "as other tools resolve monsters". Tools that name a monster type (`add_monsters`, `change_monster_type`, `preview_monsters`) take a monster key; exact-name resolution is for instance targets in an encounter.
- Options:
  - Chosen: a monster key only (`search_monsters` and `list_creatures` give keys); an unknown key is refused with `UnknownMonsterError` before any image is loaded.
  - A key or an exact type name: a new resolver for one tool, and type names are not unique across sources.
  - An instance's name: the tool would read an encounter, and art is per type (D5).
- Where: `setOwnTokenArt` (`packages/engine/src/encounter/own-token-art.ts`); `setTokenArtTool` (`packages/mcp/src/tools.ts`).
- Status: active

## 382.2 A token whose hash the type's stored art already has keeps that art and its url, writes nothing and notes no command

- Decided by: epic #375 orchestrator, 2026-11-19, plan gate (Q2), not human-approved.
- Context: Setting the same image again (a retry, or the DM repeating a request) would replace published art with an unpublished `{ sha256 }` and make the GM re-upload an image Owlbear already has. 378.1 keeps the stored source for a `table` set with the stored hash; an `agent` set has no url to republish.
- Options:
  - Chosen: `setOwnTokenArt` answers `unchanged` with the stored art and whether it is published; no art write, no `art-changed` event, no undo note. This extends 378.1's same-hash rule to an agent-set token, so 378.1 is not superseded.
  - Always assign `{ sha256 }`: the GM re-uploads and re-picks the same image.
- Where: `setOwnTokenArt`, `SetOwnTokenArtResult` (`packages/engine/src/encounter/own-token-art.ts`); `setTokenArtText` (`packages/mcp/src/tools.ts`).
- Status: active

## 382.3 One write transaction stores the token bytes, assigns the art and notes the command; the token is made before it

- Decided by: epic #375 orchestrator, 2026-11-19, plan gate, not human-approved; bytes before art by the epic #375 orchestrator, 2026-11-19 (R14), not human-approved.
- Context: Making a token is async (image load, render); the store's transactions are synchronous. Art whose bytes are missing, or an `art-changed` event with no undo note, would leave the store inconsistent if a step failed.
- Options:
  - Chosen: `makeToken` runs first and any of its errors leaves the store untouched; then `TokenArtRepository.transaction` stores the bytes, reads the stored art, assigns `{ sha256 }` with source `agent` through `assignTokenArt` and calls `noteCommandOnCurrentEncounter`. The store's transactions join one already open, so all of it commits together.
  - Separate writes: a failure between them leaves bytes with no art, or art with no note.
- Where: `setOwnTokenArt` (`packages/engine/src/encounter/own-token-art.ts`).
- Status: active

## 382.4 The extension panel keeps "Re-upload" for the first publish of the DM's own image

- Decided by: epic #375 orchestrator, 2026-11-19, plan gate (Q4), not human-approved.
- Context: Art set through `set_token_art` has no url. The panel already lists such a type with "Re-upload" and "Pick the uploaded image", as it does for library-import art that was never published (310.3), and an `mcp` `art-changed` lists the type (378.4).
- Options:
  - Chosen: no extension change; the reply tells the GM to click Re-upload, then Pick the uploaded image.
  - A separate "Upload" wording for a first publish: an extension change for one word.
- Where: `setTokenArtText` (`packages/mcp/src/tools.ts`).
- Revisit if: DMs read "Re-upload" as "this was uploaded before".
- Status: active

## 382.5 The art tools' replies name the replaced art's source in words and say how the art reaches the table

- Decided by: maintainer, 2026-11-11 (epic #375 body) that the reply says which art was replaced and where it came from; the words and the publish line by the epic #375 orchestrator, 2026-11-19, plan gate (R18, R19), not human-approved.
- Context: Sources are stored as `table`, `agent` and `default`, which mean nothing to the DM. #387's `variant` reuses the words.
- Options:
  - Chosen: `table` is "a GM pick in Owlbear", `agent` is "art set through the agent (the DM's own image or a chosen variant)", `default` is "the TooManyTokens default"; with nothing replaced the reply says "It had no art before." The reply's last line says the art is published, or tells the GM to click Re-upload, then Pick the uploaded image. Structured content is lean (`outcome`, `monsterKey`, `sha256`, `replaced`, `kept`, `published`, `summary`).
  - The raw source names: the DM would have to learn the store's vocabulary.
- Where: `ART_SOURCE_WORDS`, `setTokenArtText`, `setTokenArtTool` (`packages/mcp/src/tools.ts`).
- Status: active
