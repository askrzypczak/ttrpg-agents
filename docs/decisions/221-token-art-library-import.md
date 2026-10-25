# feature: import a local image library as token art

Issue: [#221](https://github.com/askrzypczak/ttrpg-agents/issues/221).

## 221.1 The keep, replace and same-image rule of the library import is an engine use case, `importTokenArt`

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The import decides per monster key whether to keep its art, replace it, or keep it because it already links the same image, through the engine ports `TokenArtRepository` and `TokenImageRepository`. The spec audit flagged the rule in the store adapter as a conflict with CLAUDE.md Architecture ("new game logic goes in the engine; adapters stay thin").
- Options:
  - Chosen: `importTokenArt(art, images, monsterKey, readBytes, { replace })` in the engine. It validates and saves through `storeTokenImage` (219.2) and assigns `{ sha256 }`. `readBytes` is called only when the art may change, so the engine stays free of I/O and a skipped file is never read. The store module only lists the directory, applies the naming rule, reads the files and formats the summary.
  - The rule in the store module (`packages/store-sqlite/src/token-art-import.ts`): no engine change, but the adapter would decide what happens to a key's art.
- Where: `importTokenArt`, `TokenArtImportResult` (`packages/engine/src/encounter/token-art-import.ts`); `importTokenArtLibrary` (`packages/store-sqlite/src/token-art-import.ts`).
- Status: active

## 221.2 With `--replace`, art that already links the same image is kept with its published reference

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved (an AC addition).
- Context: Imported art has no url; the table's first tokens publish it (223.4), which costs the GM two dialogs. A full `setTokenArt(key, { sha256 })` over published art erases its url.
- Options:
  - Chosen: when the key's art already has the new image's SHA-256, the file is skipped ("already has this image") and the art, url included, stays. A `--replace` re-run only replaces art whose image changed.
  - Replace every key with art: each re-run with `--replace` would unpublish all art and ask the GM to publish every type again.
- Where: `importTokenArt` (`packages/engine/src/encounter/token-art-import.ts`).
- Status: active

## 221.3 The library naming rule: top-level `<key>.<png|jpg|jpeg|webp>` files; hidden entries and directories ignored; other files and keys with several files rejected

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved (addition B: several files for one key).
- Context: The ticket names the rule `<key>.<png|jpg|jpeg|webp>` and treats the key as an opaque string. It does not say what happens to other files, letter case, or two files for one key.
- Options:
  - Chosen: only the top level of the directory, in name order. The extension is matched in any letter case, and the key is the name minus its last extension, case kept. Hidden entries (such as macOS `.DS_Store`) and anything that is not a regular file after following symlinks are ignored silently. Any other file is rejected as not named by the rule. A key with several files rejects all of them and is left as it was.
  - Ignore files outside the rule silently: a `goblin.gif` would vanish from the summary without a reason.
  - Reject hidden files too: `.DS_Store` would be listed as rejected in every summary on macOS.
  - For a key with several files, import the first in name order: which image wins would depend on file names, and a `--replace` run could switch between them.
- Where: `importTokenArtLibrary` (`packages/store-sqlite/src/token-art-import.ts`); the "Token art library" section of `packages/store-sqlite/README.md`.
- Status: active

## 221.4 The import script exits 0 when it ran, rejections included; 1 only for usage errors

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved.
- Context: The summary lists rejected files with their reasons. The script runs through `npm run`, which prints its own error block under a non-zero exit.
- Options:
  - Chosen: exit 0 after printing the summary; exit 1 with the usage line for a missing or extra argument, an unknown flag, or a directory that does not exist (checked before the database is opened). A file that cannot be read stops the run instead (221.7).
  - Exit 1 when any file was rejected: useful for scripting, which nobody does with this tool yet, and npm's error block would bury the summary.
- Where: `packages/store-sqlite/scripts/import-token-art.ts`.
- Status: active

## 221.5 A running extension sees imported art only after the Owlbear tab reloads; documented, not pushed live

- Decided by: epic #217 orchestrator, 2026-10-25, launch brief, not human-approved.
- Context: 219.1, 220.8 and 223.4 list "art can change from another source during a session (#221 import)" under Revisit if. The import writes the database directly, which creates no change-log event; a snapshot arrives only on connect or after a gap, and a type handled this session is not checked again.
- Options:
  - Chosen: keep 219.1, 220.8 and 223.4 as they are, and document the limit in the store package README and in the "Who owns what" row "Token art per monster type" of `docs/architecture.md`: reload the Owlbear tab after an import.
  - Push the change live (an event or a fresh snapshot for art changes, and re-checking types already handled): new protocol and extension work for a maintainer tool run between sessions.
- Where: `packages/store-sqlite/README.md` (Token art library); `docs/architecture.md` (Shared database; Who owns what).
- Revisit if: the import is run during play often enough that reloading the tab gets in the way.
- Status: active

## 221.6 No lint block for `packages/store-sqlite/scripts`

- Decided by: epic #217 orchestrator, 2026-10-25, plan gate, not human-approved (a spec-audit cut).
- Context: The import script imports only `@ttrpg-agents/engine` and its own package by name. `packages/srd/scripts` has no lint block either.
- Options:
  - Chosen: no `no-restricted-imports` block for the scripts directory and no CLAUDE.md clause; the script's imports are kept by review.
  - A block allowing only `engine` and `store-sqlite` there, plus a CLAUDE.md Build and boundaries clause: enforced, but nothing needs it today.
- Where: `eslint.config.js` (unchanged).
- Revisit if: a second package-level scripts directory appears or a script grows beyond argument parsing and one call.
- Status: active

## 221.7 A library file that cannot be read stops the import with an error; files imported before it stay imported

- Decided by: implementer, 2026-10-25, implementation; kept by the work-ticket orchestrator (#221) at review round 1, not human-approved.
- Context: The reviewer found that `readFileSync` throwing (no read permission, a file too large for one buffer) ends the run with a stack trace and a non-zero exit, with no summary, after earlier files were written. The README said the exit code was 0 unless the arguments were wrong.
- Options:
  - Chosen: keep it, and say so in the README: the run stops, what was imported stays, and a re-run skips it. A broken symlink or another entry `statSync` cannot read is skipped silently with the directories (221.3).
  - Reject the file with its read error and go on: the summary stays complete, but it needs an error-capturing reader around `importTokenArt` and a permission test that does not hold when run as root.
- Where: `importTokenArtLibrary` (`packages/store-sqlite/src/token-art-import.ts`); the "Token art library" section of `packages/store-sqlite/README.md`.
- Revisit if: unreadable files turn up in a real library.
- Status: active

## 221.8 A key is looked up among the art's own entries only

- Decided by: reviewer, 2026-10-25, review round 1 (applied by the work-ticket orchestrator), not human-approved.
- Context: `listTokenArt` answers a plain object, so a key named like an `Object.prototype` member (`constructor`, `toString`) read as having art and was skipped. Keys are opaque strings.
- Options:
  - Chosen: `Object.hasOwn` on the listed art before reading the key's entry, with an engine test for the key `constructor`.
  - Leave it: a library file named `constructor.png` or `toString.png` would never be imported.
- Where: `importTokenArt` (`packages/engine/src/encounter/token-art-import.ts`); test "treats a key named after an Object property, such as constructor, as having no art" (`packages/engine/src/encounter/token-art-import.test.ts`).
- Status: active
