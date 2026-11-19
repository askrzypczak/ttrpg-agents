# feature: committed TooManyTokens index with a folder-to-key mapping and a fixed default variant

Issue: [#379](https://github.com/askrzypczak/ttrpg-agents/issues/379).

## 379.1 A TooManyTokens folder's key is its exact current name, else its alias, else its `folder-keys.json` entry, else null

- Decided by: maintainer, 2026-11-11, ticket #379 body (the order and the separate file).
- Context: The pack names its folders after 2014 Monster Manual creatures. The index has to say which folder belongs to which SRD 5.2 monster key so the engine can find a monster's art.
- Options:
  - Chosen: exact current name in `monsters.json`, then `aliases.json`, then the hand-edited `folder-keys.json`, else `null`.
  - The 14 hand-mapped names in `aliases.json`: search replies would gain "Goblin is now Goblin Warrior" lines, against 345.4, which keeps that file to names search cannot find.
  - Case-insensitive matching: no folder differs from a monster name only by case at the pinned commit, so it adds a rule with no effect.
- Where: `packages/srd/src/too-many-tokens-import.ts` (`importTooManyTokensIndex`), `packages/srd/data/too-many-tokens/folder-keys.json`.
- Status: active

## 379.2 `folder-keys.json` holds the 14 SRD 5.1 names whose SRD 5.2 successor has the same CR; other folders stay null

- Decided by: maintainer, 2026-11-11, epic #375 body (the 14 folder names) and ticket #379 body (the rule: role and CR, as 345.4); epic #375 orchestrator, 2026-11-18, plan gate, not human-approved (each pair's 5.2 key and CR check, and leaving Deep Gnome, Drow, Duergar, Lizardfolk and Orc null).
- Context: About 14 folders are SRD 5.1 names with an obvious SRD 5.2 successor (Goblin for Goblin Warrior, Hellhound for Hell Hound) that `aliases.json` leaves out by design. Five other SRD 5.1 names have no SRD 5.2 statblock.
- Options:
  - Chosen: the 14 pairs, each checked against Open5e srd-2014 for the same CR and role (the PR body has the table); Deep Gnome, Drow, Duergar, Lizardfolk, Orc and every non-SRD folder stay `null`, and the GM picks their art as today.
  - Map the five names with no successor to the nearest 5.2 statblock: the role or CR differs, so the default art would show another creature.
- Where: `packages/srd/data/too-many-tokens/folder-keys.json`.
- Revisit if: the snapshot moves to a later SRD, or the pack adds folders.
- Status: active

## 379.3 The default TooManyTokens variant is the first file, in code-unit order, of the first folder, with the folder named like the monster first

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved (the epic body's suggested default for open question 1; the maintainer was asked to confirm or veto).
- Context: Art is one image per monster type, and a folder holds 6 to 1,009 variants, so the default needs a fixed rule.
- Options:
  - Chosen: the first element of `tooManyTokensVariants` (folders named like the monster first, then the others, each group in code-unit order of the name; files in code-unit order). A contact sheet to choose another is #387.
  - A hand-curated default per monster: one more data file to keep for 266 keys.
  - A random variant per type: the same type would get different art on each fresh store.
- Where: `packages/engine/src/encounter/too-many-tokens.ts` (`tooManyTokensVariants`, `defaultVariant`).
- Revisit if: the maintainer vetoes, or use shows the first images are poor.
- Status: active

## 379.4 TooManyTokens URL path segments use strict RFC 3986 encoding

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: Most file names hold spaces and parentheses (`GoblinForestMaleGraygreenMelee (1).webp`), and one folder holds an apostrophe (`Will-o'-Wisp`). The ticket asks for each path segment percent-encoded.
- Options:
  - Chosen: `encodeURIComponent` plus `!'()*` as `%XX`, per segment.
  - Plain `encodeURIComponent`: leaves parentheses and apostrophes raw, against the ticket's wording.
- Where: `packages/engine/src/encounter/too-many-tokens.ts` (`tooManyTokensUrls`).
- Status: active

## 379.5 The TooManyTokens index has no fetch date; the commit is its provenance

- Decided by: epic #375 orchestrator, 2026-11-18, plan gate, not human-approved.
- Context: The ticket asks that a refresh writes the same file twice for the same commit.
- Options:
  - Chosen: no timestamp; the same commit gives the same bytes.
  - A `fetchedAt` field like `monsters.meta.json`: two runs at the same commit would differ.
- Where: `packages/srd/src/too-many-tokens-import.ts` (`importTooManyTokensIndex`), `packages/srd/data/too-many-tokens/index.json`.
- Status: active
