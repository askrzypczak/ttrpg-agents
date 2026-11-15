# feature: create a creature, from scratch or by cloning an existing one

Issue: [#385](https://github.com/askrzypczak/ttrpg-agents/issues/385).

## 385.1 A creature created from scratch starts with empty sections, lists, skills and senses and an empty armor detail; every other field is required

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: The ticket says every missing field of a from-scratch create is a schema error. A 2024 statblock prints no armor detail, and no skills, senses beyond passive Perception, resistances or immunities when there are none, so the DM would have to type empty values for them.
- Options:
  - Chosen: the five sections, the four damage and condition lists, `skills` and `senses` start empty and `armorDetail` starts `""`; `name`, `size`, `type`, `alignment`, `ac`, `hp`, `speeds`, `abilities`, `saves`, `initiativeModifier`, `cr` and `languages` must be given.
  - Only the five sections start empty (section changes are operations and need a base): the DM types `[]`, `{}` and `""` for every empty field.
  - Nothing starts filled, as the ticket reads literally: a section named in the changes starts from an empty list, and every other field or section not named is a schema error.
- Where: `packages/engine/src/monsters/create-creature.ts` (`createCreature`).
- Status: active

## 385.2 A key that a stored creature of another name already holds is refused, naming that creature; no suffix is minted

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: Two names can give one slug ("Goblin, Shaman" and "Goblin Shaman"), and a rename (#386) keeps the old key, so the minted key can be taken under another name.
- Options:
  - Chosen: refuse with `CreatureNameTakenError`, naming the creature that holds the key; the DM picks a distinct name. Keys stay stable and predictable from the name.
  - Mint `<key>-2`: the key no longer follows from the name, and the DM cannot guess it.
- Where: `packages/engine/src/monsters/create-creature.ts` (`createCreature`).
- Revisit if: DMs often hit the refusal with names that differ only in punctuation.
- Status: active

## 385.3 Every statblock, SRD included, shows a `Source:` line under its header

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved.
- Context: The ticket asks that `get_statblock` of a stored creature show its book and page. `mcp` cannot tell a stored creature from a built-in one without the reserved-tag rule, which 381.4 keeps inside the engine.
- Options:
  - Chosen: `formatStatblock` adds `Source: <book>[, page N]` for every monster (`formatSource`).
  - Stored creatures only: needs an engine export that says "stored", against 381.4.
- Where: `packages/mcp/src/statblock.ts` (`formatSource`, `formatStatblock`).
- Status: active

## 385.4 One changes schema in the engine serves the tool input and the use case: scalars replace, maps merge by key with `null` removing a key, lists replace, sections take remove, replace and add

- Decided by: epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (on the #385 planner's proposal).
- Context: `create_creature` and #386's `edit_creature` apply a partial statblock to a base. The MCP input and the engine must agree on its shape.
- Options:
  - Chosen: `creatureChangesSchema` (zod, strict, built from `monsterSchema`'s field schemas) in the engine, imported by `mcp` as the tool input. `abilities` and `saves` merge numbers; `speeds`, `senses` and `skills` merge with `null` removing a key; the damage and condition lists replace; each section applies `remove` (names), `replace` (whole entries matched by name) and `add`, in that order, names matching ignoring case. A name that matches no entry or several is refused, listing the section's names.
  - A TypeScript type in the engine and a separate zod input in `mcp`: two definitions to keep in step.
  - Whole sections replaced: a one-entry change means retyping every entry of the section.
- Where: `packages/engine/src/monsters/creature-changes.ts` (`creatureChangesSchema`, `applyCreatureChanges`), `packages/mcp/src/tools.ts` (`create_creature`).
- Status: active

## 385.5 A stored creature's key is `<book>_<slug of the name>`, with accents folded and apostrophes dropped

- Decided by: maintainer, 2026-11-11, epic #376 body (the key shape, minted from the name at creation); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (the slug rule).
- Context: The slug must be `[a-z0-9-]+` and match the SRD keys' style ("Will-o'-Wisp" gives `will-o-wisp`).
- Options:
  - Chosen: NFKD with combining marks removed, lower case, `'` and `’` dropped, every other run of characters outside `[a-z0-9]` one hyphen, no hyphen at either end. A name with no letter or digit is refused at `name`.
  - Apostrophes as hyphens: "Will-o'-Wisp" gives `will-o--wisp` collapsed to `will-o-wisp` anyway, but "Ki'rin" gives `ki-rin`, unlike the way the name is said.
- Where: `packages/engine/src/monsters/creature-changes.ts` (`creatureKey`).
- Status: active

## 385.6 A creature command notes itself on the open scene's encounter, else the current one, and never creates or switches one

- Decided by: maintainer, epic #376 body and #363 body (creature tools are not encounter commands; they note the command when an encounter exists); epic #376 orchestrator, 2026-11-15, plan gate, not human-approved (one engine helper for it).
- Context: `undo` must say it does not cover a creature change, so the change needs an undo barrier on the encounter the DM would undo in.
- Options:
  - Chosen: `noteCommandOnCurrentEncounter` in `packages/engine/src/encounter/directory.ts`: the encounter a read-form resolution without a name would act on, or nothing; #386 reuses it.
  - Inline in `createCreature`: #386's three tools would copy it.
- Where: `packages/engine/src/encounter/directory.ts` (`noteCommandOnCurrentEncounter`), `packages/engine/src/monsters/create-creature.ts`.
- Status: active

## 385.7 Check findings are warnings: a creature with findings is stored and the reply lists them

- Decided by: epic #376 orchestrator, 2026-11-14, epic Q3 default (the maintainer has not confirmed), not human-approved.
- Context: The check (#384) compares damage averages, attack bonuses and DCs with the rules; a book sometimes prints a value on purpose.
- Options:
  - Chosen: never block; the reply lists each finding with its expected values and points to `edit_creature`.
  - Refuse on `damage_average` and `attack_bonus` findings: blocks a statblock copied faithfully from a book with a misprint or a deliberate exception.
- Where: `packages/engine/src/monsters/create-creature.ts` (`createCreature`), `packages/mcp/src/creature-reply.ts` (`formatCreatureCheck`).
- Revisit if: the maintainer answers epic Q3 otherwise.
- Status: active

## 385.8 A book tag is the DM's short tag for the book, reused for every creature of it; `homebrew` holds invented creatures

- Decided by: epic #376 orchestrator, 2026-11-14, epic Q4 default (the maintainer has not confirmed), not human-approved.
- Context: Stored keys are `<book>_<slug>`, so the tag is part of every key and of the one-name-per-book rule.
- Options:
  - Chosen: a lower-case tag the DM picks once per book (such as `mm-2024`) and reuses; `homebrew` for invented creatures. `create_creature`'s description and its `BookTagError` messages give those examples.
  - A fixed list of known book tags: the engine would have to know every book the DM owns.
- Where: `packages/mcp/src/tools.ts` (`create_creature`), `packages/engine/src/monsters/create-creature.ts` (`BookTagError` messages).
- Revisit if: the maintainer answers epic Q4 otherwise.
- Status: active
