# feature: change an existing monster to a different monster type, keeping its token's place

Issue: [#285](https://github.com/askrzypczak/ttrpg-agents/issues/285).

## 285.1 One PR, not split

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: the ticket asked for a split at the plan gate under the five-package rule (CLAUDE.md), expecting the protocol to change. The plan's Interfaces touch four packages (engine, store-sqlite, mcp, owlbear): the protocol reuses the engine's `encounterEventSchema` unchanged and the bridge relays change-log rows without reading their kind (as 277.1 found).
- Options:
  - Chosen: one PR. The rule's condition is not met.
  - Split by layer (store method and event first, then the use case, the tool and the extension): one more run and review, and a store method with no production caller until the second lands.
- Where: this ticket's body (unchanged).
- Status: active

## 285.2 The initiative keeps its roll and swaps the modifier

- Decided by: maintainer, 2026-10-26 (answer to the ticket's open question).
- Context: a changed monster's initiative could be kept, rolled again or adjusted.
- Options:
  - Chosen: new initiative = current initiative minus the old monster's initiative modifier plus the new monster's; an instance with no initiative keeps none.
  - Keep the value as is: the old monster's modifier stays in it.
  - Roll again with the new modifier: the monster loses its place in the turn order.
- Where: `changeMonsterType` (`packages/engine/src/encounter/change-monster.ts`).
- Status: active

## 285.3 The damage already taken carries over

- Decided by: maintainer, 2026-10-26 (answer to the ticket's open question).
- Context: the new monster gets a new max HP; its current HP could start full or keep the damage.
- Options:
  - Chosen: new current HP = new max HP minus the damage taken (old max minus old current), clamped at 0 by the engine.
  - Start at full HP: the fight's damage is lost.
- Where: `changeMonsterType`.
- Status: active

## 285.4 The initiative group is kept

- Decided by: maintainer, 2026-10-26 (answer to the ticket's open question).
- Context: the instance's `groupId` could be kept or replaced by a new group.
- Options:
  - Chosen: the same `groupId`. A group may mix monster types (287.7).
  - A new group of its own: `split_initiative` already does that on request.
- Where: `changeMonsterType`.
- Status: active

## 285.5 A monster whose footprint grew is changed anyway, its token stays where it is, and the reply says it no longer fits its cell

- Decided by: maintainer, 2026-10-26 (change anyway, leave the token, say so); the meaning of "no longer fits" is the epic #280 orchestrator's, 2026-10-26, plan gate, not human-approved.
- Context: a larger footprint can overlap neighbouring cells where the token stands.
- Options:
  - Chosen: the engine reports `noLongerFits` when the new footprint is larger than the old one, and the tool's line ends with "no longer fits its cell (now NxN cells)"; nothing is asked of the table, so it works without the bridge. The DM can follow with `move_monsters`.
  - Check the new footprint's block at the token's spawn position against the room and the table's tokens: needs the bridge and a map in use, the engine cannot tell which table token is the monster's (277.9), and a token in the default row or dragged by the GM has no known cell.
- Where: `ChangedMonster.noLongerFits` (`packages/engine/src/encounter/change-monster.ts`); `change_monster_type` (`packages/mcp/src/tools.ts`).
- Revisit if: `TableToken` gains the instance id (277.9's revisit), so the token's real cells are known.
- Status: active

## 285.6 One batch repository method writes the whole change in one transaction, with one `monster-changed` event per instance

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that a new repository method stores the change and an event carries it to the extension is the maintainer's (#285).
- Context: a change touches the monster key, name, HP, AC, initiative and footprint of several instances; #283 (undo) should see one event per instance.
- Options:
  - Chosen: `EncounterRepository.changeMonsters(changes, origin)` validates every id (UnknownInstanceError) and new name (InvalidNameError) and writes every entry in one transaction, appending one `monster-changed` event (`id`, `monsterKey`, `displayName`, `maxHp`, `currentHp`, `armorClass`, `initiative`, `footprint`) per entry. The use case computes every value and validates every target before the call. It follows `setSpawnPositions` (277.2): truly all or nothing.
  - One transaction per instance, all or nothing by validating first: a write failing part way leaves some monsters changed.
  - Several setters and events per instance (`instance-changed`, `hp-changed`, new key and footprint setters): the extension would apply a change in pieces and undo would see several events.
- Where: `EncounterRepository.changeMonsters`, `MonsterChange` (`packages/engine/src/encounter/repository.ts`); `encounterEventSchema` (`packages/engine/src/encounter/events.ts`); `SqliteEncounterRepository.changeMonsters` (`packages/store-sqlite/src/sqlite-repository.ts`).
- Status: active

## 285.7 A target that already is the requested monster fails the whole call

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: changing a goblin to a goblin would rename it to the next free number and roll its HP again, a quiet renumbering the epic avoids.
- Options:
  - Chosen: `SameMonsterError` (code `same_monster`), checked before any roll or write; nothing changes and the DM re-issues the call without that target. All or nothing, like every mutation of the epic.
  - Skip that target and say so in the reply: a partial success the DM must read carefully.
  - Change it anyway: renumbers and re-rolls.
- Where: `SameMonsterError` (`packages/engine/src/encounter/errors.ts`); `changeMonsterType`.
- Status: active

## 285.8 The old monster must be in the index only for a target that has an initiative

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate (spec audit), not human-approved.
- Context: the old monster's initiative modifier is read only to adjust an initiative (285.2); an instance with none keeps none.
- Options:
  - Chosen: UnknownMonsterError, before any roll or write, only when a target with an initiative has a monster key the index does not know.
  - Require it for every target, as `resetMaxHp` does: blocks correcting a monster whose old type left the index for no reason.
- Where: `changeMonsterType`.
- Status: active

## 285.9 The MCP tool is `change_monster_type`, with `targets`, `monster` and `hp`, one reply line per monster

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; a tool taking targets and a monster key, resolved with `search_monsters`, is the maintainer's (#285).
- Context: the tool's name was left to the plan.
- Options:
  - Chosen: `change_monster_type` `{ targets, monster, hp? }`, `hp` defaulting to rolled as in `add_monsters`; targets are ids or exact names and all must resolve. Each line reads `<old name> -> <new name>: HP a/b -> c/d, AC x -> y, initiative p -> q` (`none` for a missing value), then the no-fit clause (285.5), then the Rolls lines after a rolled change. No line about a group's initiative: the reply's initiative change shows it, and `merge_initiative` realigns a group.
  - A line saying a changed member's initiative now differs from its group: one more engine verdict for what the reply already shows.
- Where: `change_monster_type` (`packages/mcp/src/tools.ts`); `.claude/skills/dm-encounter/SKILL.md`.
- Status: active

## 285.10 A changed monster's token is redrawn in place and keeps its kind

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the extension updates the token's name, size and art on reconcile is the maintainer's (#285).
- Context: Owlbear's item `type` is read-only, so an image token cannot become a circle (or back) through `updateItems`.
- Options:
  - Chosen: an image token takes the new type's usable art (the picker and republish flow of a new token runs for a type with none), else keeps its own picture; a circle stays a circle; both get the new footprint. Follow-up #303 replaces a token whose kind must change.
  - Replace the token (add a new one, delete the old) when its kind must change: Owlbear deletes the GM's attachments with the old token, and a failure between the two writes reads as a GM deletion unless a recovery rule is added.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`); `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`); `createObrAdapter().updateItems` (`packages/owlbear/src/obr-adapter.ts`).
- Revisit if: #303 lands.
- Status: active

## 285.11 Each token records the type and picture it was drawn with; a redraw resets scale to 1 and is listed when the token's art or size had changed

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that a write over a table value is visible to the GM is the maintainer's (#209, #280).
- Context: size and art belong to the table after creation; the redraw overwrites them only on the DM's request, and the GM must be able to audit it.
- Options:
  - Chosen: the synced record gets a reserved key `look` (`LOOK_BASELINE_KEY`) holding `{ monsterKey, image }` (the picture's url, null for a circle), written at creation and after each redraw; older tokens get none and none is adopted (as 277.4). The redraw sets scale to 1. When a redraw is written over a token whose picture differs from the recorded one or whose scale is not 1, or that has no record, the override list gets a note ("had been changed" or "may have been changed"), reported right after the write (as 277.10). The footprint is not recorded: it follows from the monster type (spec audit).
  - Keep the GM's scale: no size is ever overwritten, but a token the GM scaled for its old monster keeps that scale on the new one.
  - Two keys (size and art): written and compared together anyway.
- Where: `LOOK_BASELINE_KEY`, `restyleOverrideNote`, `planSync` (`packages/owlbear/src/sync-plan.ts`); `apply` (`packages/owlbear/src/encounter-sync.ts`); `#overrides` (`packages/owlbear/index.html`).
- Revisit if: the DM finds the notes noisy.
- Status: active

## 285.12 A token is redrawn on the `mcp` event, or when a snapshot shows a monster type different from its record

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved.
- Context: a change made while the extension was offline reaches it only in a snapshot.
- Options:
  - Chosen: an `mcp` `monster-changed` event adds its instance to a `restyles` set that the next reconcile takes (and restores on failure, like `moves`); `planSync` redraws an existing token when its instance is in `restyles` or its recorded look names another monster key. The token is written only when it differs from the target look; the record becomes the target either way. It follows 277.5.
  - Events only: a change made while offline never reaches the token.
- Where: `planSync` (`packages/owlbear/src/sync-plan.ts`); `createEncounterSync` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active

## 285.13 "Who owns what" splits token visibility from token size and art

- Decided by: epic #280 orchestrator, 2026-10-26, plan gate, not human-approved; that the row changes for this request is the maintainer's (#285).
- Context: 277.8 left "Visibility, size and art of a token" create-only so this ticket could split size and art beside it.
- Options:
  - Chosen: "Token visibility" (create-only) and "Token size and art" (create-only, except one redraw per monster-type change, listed in the panel when the table had or may have changed them); the Token name row adds the monster change.
  - Reword the shared row: visibility, which nothing redraws, would read as changing.
- Where: `docs/architecture.md` (What reaches the table, Who owns what).
- Status: active

## 285.14 Every type a redraw needs art for goes through the stored-art check, whether or not the redraw writes

- Decided by: reviewer, 2026-10-26, review round 1 (blocker); not human-approved.
- Context: the stored-art check (republishing art whose url is gone, or publishing art without a url) took only the types of redraws that write. An image token changed to a type of the same footprint whose stored art has no url falls back to its own picture, plans no write, and so never had the type's art published: it kept the old type's picture for good.
- Options:
  - Chosen: `apply` adds every type in the first plan's `needsArt` to the types it checks, as for new tokens; the check already skips types without a hash, checked or declined this session.
  - Only the types of redraws that write: misses the case above.
- Where: `apply` (`packages/owlbear/src/encounter-sync.ts`).
- Status: active
