import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE encounters (
        id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX encounters_one_active ON encounters (active) WHERE active = 1;
      CREATE TABLE monster_instances (
        id TEXT PRIMARY KEY,
        encounter_id TEXT NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
        monster_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        max_hp INTEGER NOT NULL CHECK (max_hp > 0),
        current_hp INTEGER NOT NULL,
        initiative INTEGER,
        group_id TEXT,
        created_at INTEGER NOT NULL,
        CHECK (current_hp >= 0 AND current_hp <= max_hp)
      );
      CREATE INDEX monster_instances_encounter ON monster_instances (encounter_id);
    `,
  },
  {
    version: 2,
    sql: "ALTER TABLE monster_instances ADD COLUMN armor_class INTEGER;",
  },
  {
    version: 3,
    sql: `
      CREATE TABLE token_art (
        monster_key TEXT PRIMARY KEY,
        url TEXT NOT NULL CHECK (url LIKE 'https://%'),
        mime TEXT NOT NULL CHECK (mime LIKE 'image/%'),
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0)
      );
    `,
  },
  {
    version: 4,
    sql: "ALTER TABLE monster_instances ADD COLUMN footprint INTEGER NOT NULL DEFAULT 1 CHECK (footprint >= 1);",
  },
  {
    version: 5,
    sql: "ALTER TABLE monster_instances ADD COLUMN stats_visible INTEGER NOT NULL DEFAULT 0;",
  },
  {
    version: 6,
    sql: "CREATE TABLE encounter_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL);",
  },
  {
    version: 7,
    sql: `
      CREATE TABLE token_art_image (
        sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
        mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0),
        bytes BLOB NOT NULL
      );
      ALTER TABLE token_art ADD COLUMN sha256 TEXT REFERENCES token_art_image (sha256);
    `,
  },
  {
    // Art may be stored bytes never published: the reference (url, mime,
    // width, height) is all set, or all NULL with an image hash. SQLite cannot
    // alter a column's constraints, so the table is rebuilt; nothing refers
    // to token_art.
    version: 8,
    sql: `
      CREATE TABLE token_art_new (
        monster_key TEXT PRIMARY KEY,
        url TEXT CHECK (url LIKE 'https://%'),
        mime TEXT CHECK (mime LIKE 'image/%'),
        width INTEGER CHECK (width > 0),
        height INTEGER CHECK (height > 0),
        sha256 TEXT REFERENCES token_art_image (sha256),
        CHECK (
          (url IS NOT NULL AND mime IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)
          OR (url IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL AND sha256 IS NOT NULL)
        )
      );
      INSERT INTO token_art_new (monster_key, url, mime, width, height, sha256)
        SELECT monster_key, url, mime, width, height, sha256 FROM token_art;
      DROP TABLE token_art;
      ALTER TABLE token_art_new RENAME TO token_art;
    `,
  },
  {
    // A map item's registration: its name and how it sits on the scene grid.
    // Rows are updated in place when the same item is registered again; one
    // row is the active map.
    version: 9,
    sql: `
      CREATE TABLE map_registrations (
        item_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        rotation REAL NOT NULL,
        scale_x REAL NOT NULL,
        scale_y REAL NOT NULL,
        image_offset_x REAL NOT NULL,
        image_offset_y REAL NOT NULL,
        image_width REAL NOT NULL CHECK (image_width > 0),
        image_height REAL NOT NULL CHECK (image_height > 0),
        image_dpi REAL NOT NULL CHECK (image_dpi > 0),
        scene_dpi REAL NOT NULL CHECK (scene_dpi > 0),
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
      );
      CREATE UNIQUE INDEX map_registrations_one_active ON map_registrations (active) WHERE active = 1;
    `,
  },
];

export const LATEST_VERSION = Math.max(...migrations.map((m) => m.version));

export function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version;
}

/**
 * Applies pending migrations in order, each in its own transaction. The
 * version is re-read under a write lock so concurrent openers apply each
 * migration exactly once.
 */
export function migrate(db: DatabaseSync): void {
  // Cheap pre-check to avoid taking a write lock when nothing is pending.
  if (getUserVersion(db) >= LATEST_VERSION) return;
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of ordered) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (getUserVersion(db) >= m.version) {
        db.exec("ROLLBACK");
        continue;
      }
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
