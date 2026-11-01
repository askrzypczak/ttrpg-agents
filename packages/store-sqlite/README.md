# @ttrpg-agents/store-sqlite

SQLite encounter store over Node's built-in `node:sqlite`. `openDatabase` opens and migrates the database, and the repositories implement the engine's ports:

- `SqliteEncounterRepository` implements `EncounterRepository`: the encounter (`monster_instances`, `encounters`) and the undo records (`undo_commands`, `undo_instances`, migration 14: one record per MCP command that changed the encounter, with its tool name and the change-log `seq` before its first write, and per instance it wrote, that instance's state before the command's first write to it). `SqliteEncounterLog` implements `EncounterLog` over the change log (`encounter_events`).
- `SqliteTokenArtRepository` implements `TokenArtRepository`: the art of each monster key (table `token_art`, migration 3), a VTT-neutral reference `{ url, mime, width, height }` with an optional `sha256` link to stored bytes and no bytes of its own. Since migration 8 the reference is absent, all four columns together, when the row links stored bytes never published, so such art lists as `{ sha256 }` only.
- `SqliteTokenImageRepository` implements `TokenImageRepository`: validated image bytes keyed by SHA-256 (table `token_art_image`, migration 7, no monster key).
- `SqliteMapRepository` implements `MapRepository`: the map registrations by map item id, one of them active (table `map_registrations`, migration 9; registering the same item again updates its row in place), and the rooms named on each map (table `map_rooms`, migration 10: per map item id, each room's name, status and image-pixel polygons; re-registering the map keeps them, and `removeRooms` deletes them).
- `importTokenArtLibrary` imports a local library of token art images into the same database (`npm run import:token-art`, see Token art library).

Removing an instance keeps its row, marked removed with the change that removed it (migration 12: the change-log `seq` of its `removed` event, and its origin's source and command id). Removed instances are out of `listInstances` and of every per-id mutation; `listRemovedInstances` lists them newest removal first, and `restoreInstances` puts them back, recording on each the `seq` of the `added` event it logs (migration 15, `restored_seq`). `listRestoreSeqs` lists that `seq` for each instance in the encounter that has one, so an instance removed again drops out and a later restore replaces it.

`clearEncounter` keeps the instances it clears, marked removed with the clear's origin and the seq of its `cleared` event, which the encounter records as `cleared_seq` (migration 13). It deletes the instances removed before it, so only the last clear's set can be restored. A clear of an empty encounter changes nothing but the change log. `listRemovedInstances` marks the last clear's set `cleared`.

## Database path

`openDatabase()` without an argument uses, in order:

1. `$TTRPG_AGENTS_DB`
2. `$XDG_DATA_HOME/ttrpg-agents/encounters.db`
3. `~/.local/share/ttrpg-agents/encounters.db`

File databases get their parent directory created, WAL journaling and a 5 s busy timeout. `":memory:"` is for tests.

## Token art library

The library is a directory of image files that you keep anywhere outside the repo. Like the monster data, it is never committed. `npm run import:token-art` stores its images as token art in the database.

- Naming: `<monster key>.<png|jpg|jpeg|webp>`, with the extension in any letter case. The key is the file name without the extension, exactly as the encounter uses it, for example `srd-2024_goblin.png`. Any key works; it is never checked against the SRD.
- Hidden files (such as `.DS_Store`) and subdirectories are ignored. Other files are rejected, and so is a key with several files: all of its files are rejected.
- Caps: PNG, JPEG or WebP, at most 1 MiB and 2048 px on the longer side.

Run it from the repo root:

```sh
npm run import:token-art -w @ttrpg-agents/store-sqlite -- ~/token-art
npm run import:token-art -w @ttrpg-agents/store-sqlite -- ~/token-art --replace
```

The `--` separates npm's arguments from the script's. A relative directory is resolved from where you run npm. The import writes the database `openDatabase()` uses (see Database path), and it is safe while the bridge runs.

The output is one line per file, as stored, skipped or rejected (with the reason), then the counts. The exit code is 0 when the run completes, rejected files included, and 1 when the arguments are wrong. A file that cannot be read (for example one without read permission), or a database error, stops the run with an error and exit code 1: files imported before it stay imported, and running the same command again skips them (as "already has art", or "already has this image" with `--replace`) and imports the rest.

Existing art is kept unless `--replace` is given. With `--replace`, a key whose art already links the same image keeps it, with its Owlbear reference. Any other art is replaced and loses its Owlbear reference.

Imported art has no url. When its monster type first gets a token at the table, the extension uploads the image to the GM's Owlbear library: confirm the folder in Owlbear's upload dialog, press "Pick the uploaded image" in the panel, then pick the image.

A running extension sees imported art only after the Owlbear tab reloads (a type already handled this session keeps its art until then), so reload the tab after an import.

## Migrations

The schema is versioned SQL in `src/migrations.ts` (the `migrations` array of `{ version, sql }`). The applied version lives in SQLite's `PRAGMA user_version`. `openDatabase` calls `migrate`, which applies each pending migration in version order, each in its own `BEGIN IMMEDIATE` transaction. The version is re-read under the write lock, so concurrent openers apply each migration once. A schema change is a new entry with the next version number.
