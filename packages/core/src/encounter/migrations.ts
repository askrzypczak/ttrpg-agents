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
];

export const LATEST_VERSION = Math.max(...migrations.map((m) => m.version));

export function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version;
}

/** Applies pending migrations in order, each in its own transaction. */
export function migrate(db: DatabaseSync): void {
  const current = getUserVersion(db);
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
