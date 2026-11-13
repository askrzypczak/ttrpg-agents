# The Invented Bestiary

The Invented Bestiary is the test book, tagged `test-book`. Every name, word and number in it is invented for this repo and is under the repo's license (`LICENSE`).

It is for import tests and evals, so that no text or numbers from a published book are ever needed. The rule behind it is the book-content rule in `CLAUDE.md`.

## What is in it

- `pages/012-mirewick-lurker.md`: Mirewick Lurker, 2024 layout, page 12. Multiattack, an attack (Claw), a trait, skills and darkvision.
- `pages/027-cinderling-sentry.md`: Cinderling Sentry, 2024 layout, page 27. A saving-throw action with a recharge (Cinder Breath), a vulnerability, damage and condition immunities, and a language.
- `pages/041-ashfeather-harrier.md`: Ashfeather Harrier, 2024 layout, page 41. A saving-throw action limited to one use per day (Ash Shriek), an attack (Talons) and a flying speed. It carries the deliberate error below.
- `pages/058-gloomcap-shambler.md`: Gloomcap Shambler, 2014 layout, page 58. An attack (Slam), a saving-throw action (Spore Puff), blindsight and condition immunities.

## The deliberate error

The Ashfeather Harrier's Talons print `9 (2d6 + 3)`, whose average is 10. The error is on purpose: it is there for the create-time statblock check and the prep evals. Do not fix it. It is the book's only inconsistency: every other attack bonus, save DC, save, initiative and damage average follows the rules.

## creatures.json

`creatures.json` holds the four statblocks as printed, the deliberate error included, in the shape of `monsterSchema` (`packages/engine/src/monsters/schema.ts`). Its `source` follows that schema: `"private"` today, and `{ book, page }` once the schema changes.
