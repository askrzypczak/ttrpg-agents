# chore: content rule for a public repo: the CLAUDE.md line, an invented test book, and a data-file allowlist check

Issue: [#374](https://github.com/askrzypczak/ttrpg-agents/issues/374).

## 374.1 Data files may be committed only in four directories, recognised by extension over `git ls-files`, with `package.json` and `tsconfig*.json` excepted at the root and in each package

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved (the exception scope; the directories and extensions are the ticket's).
- Context: The repo is public, so the check keeps data files (JSON, text, images, PDFs, databases) out of everywhere except `packages/srd/data/`, `packages/srd/src/fixtures/`, `packages/owlbear/public/` and `fixtures/test-book/`. Each package has its own `package.json` and `tsconfig*.json`, which are data files by extension.
- Options:
  - Chosen: `package.json` and `tsconfig*.json` are excepted at the repo root and directly in `packages/<name>/`; `package-lock.json`, `.prettierrc.json`, `.mcp.json` and `.claude/settings.json` by exact path. A new package's own manifest and tsconfigs need no change to the check.
  - Exact paths only, as the ticket listed them: fails the 20 package manifests and tsconfigs on today's tree.
  - The file name anywhere: a `package.json` inside a data folder would pass.
  - No check, the `CLAUDE.md` rule alone: nothing stops a data file in the wrong place.
- Where: `scripts/data-files.ts` (`dataFileViolations`, `ALLOWED_DATA_DIRS`), `scripts/data-files.integration.test.ts`, `CLAUDE.md` Conventions.
- Revisit if: a data file is needed outside the four directories.
- Status: active

## 374.2 The test book's keys carry the book tag `test-book`, its pages carry their page numbers, and `creatures.json` records each statblock as printed, the deliberate error included

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: Import tests and evals (Epic N) need a book with no text or numbers from a published book. Epic N mints stored-creature keys as `<book>_<slug>`, and its evals fix the book's one deliberate error with `edit_creature` after import.
- Options:
  - Chosen: keys `test-book_<slug>`, page numbers in the page file names and footers, statblocks as printed (Ashfeather Harrier's Talons keep the wrong average).
  - Corrected statblocks in `creatures.json`: an import test would expect values the page does not show, and the fix-with-`edit_creature` eval would contradict the fixture.
  - Keys without a book tag: would not match Epic N's `<book>_<slug>` keys.
- Where: `fixtures/test-book/` (`creatures.json`, `pages/`, `README.md`).
- Revisit if: Epic N's key or `source` scheme changes.
- Status: active

## 374.3 The deliberate error is pinned by the create-time check where it is built (#384), not by a test-book test now

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate (spec-auditor cut), not human-approved.
- Context: The test book promises that the Ashfeather Harrier's Talons average is its only inconsistency. A test here could check damage averages only, not every rule the create-time check will cover.
- Options:
  - Chosen: a note in `fixtures/test-book/README.md` now. The epic #366 orchestrator proposed the exactly-one-finding acceptance criterion for #384's checker on #384, after the gate, once the maintainer allowed comments outside the epic: https://github.com/askrzypczak/ttrpg-agents/issues/384#issuecomment-6815299886.
  - A unit test in `scripts/` that parses `N (dice)` pairs: rebuilds #384's parsing and covers damage averages only.
  - A follow-up ticket now: not chosen at the gate.
- Where: `fixtures/test-book/README.md`.
- Revisit if: #384 lands without such a check.
- Status: active

## 374.4 Database files fail the data-file check everywhere, allowed directories included

- Decided by: epic #366 orchestrator, 2026-11-12, plan gate, not human-approved.
- Context: `.gitignore` has no `*.db` entry, and database backups must stay out of the repo (the book-content rule in `CLAUDE.md`).
- Options:
  - Chosen: `.db` and `.sqlite` fail in every directory.
  - Only outside the allowed directories: a `.db` in `packages/srd/data/` would pass.
- Where: `scripts/data-files.ts` (`dataFileViolations`).
- Status: active
