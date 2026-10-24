# @ttrpg-agents/store-sqlite

SQLite encounter store: `SqliteEncounterRepository` implements the `EncounterRepository` port from `@ttrpg-agents/engine`, `SqliteTokenArtRepository` implements `TokenArtRepository` (the image reference the GM picked for each monster key, table `token_art`, migration 2; a VTT-neutral reference `{ url, mime, width, height }`, no image bytes), `SqliteTokenImageRepository` implements `TokenImageRepository` (validated image bytes keyed by SHA-256, table `token_art_image`, migration 6, no monster key), and `openDatabase` opens and migrates the database. Uses Node's built-in `node:sqlite`.

## Database path

`openDatabase()` without an argument uses, in order:

1. `$TTRPG_AGENTS_DB`
2. `$XDG_DATA_HOME/ttrpg-agents/encounters.db`
3. `~/.local/share/ttrpg-agents/encounters.db`

File databases get their parent directory created, WAL journaling and a 5 s busy timeout. `":memory:"` is for tests.

## Migrations

The schema is versioned SQL in `src/migrations.ts` (the `migrations` array of `{ version, sql }`). The applied version lives in SQLite's `PRAGMA user_version`. `openDatabase` calls `migrate`, which applies each pending migration in version order, each in its own `BEGIN IMMEDIATE` transaction. The version is re-read under the write lock, so concurrent openers apply each migration once. A schema change is a new entry with the next version number.
