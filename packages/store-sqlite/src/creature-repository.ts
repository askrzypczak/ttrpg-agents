import type { DatabaseSync } from "node:sqlite";
import type {
  CreatureRecord,
  CreatureRepository,
  Monster,
} from "@ttrpg-agents/engine";

type CreatureRow = { key: string; data: string };

function toRecord(row: CreatureRow): CreatureRecord {
  return { key: row.key, data: JSON.parse(row.data) as unknown };
}

/** Stored creatures in the `creatures` table (migration 20) of the shared database. */
export class SqliteCreatureRepository implements CreatureRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getRecord(key: string): CreatureRecord | undefined {
    const row = this.db
      .prepare("SELECT key, data FROM creatures WHERE key = ?")
      .get(key) as CreatureRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  listRecords(): CreatureRecord[] {
    const rows = this.db
      .prepare("SELECT key, data FROM creatures ORDER BY key")
      .all() as CreatureRow[];
    return rows.map(toRecord);
  }

  insert(key: string, monster: Monster): void {
    this.db
      .prepare("INSERT INTO creatures (key, data) VALUES (?, ?)")
      .run(key, JSON.stringify(monster));
  }

  replace(key: string, monster: Monster): void {
    const result = this.db
      .prepare("UPDATE creatures SET data = ? WHERE key = ?")
      .run(JSON.stringify(monster), key);
    if (result.changes === 0) {
      throw new Error(`No stored creature has the key "${key}"`);
    }
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM creatures WHERE key = ?").run(key);
  }
}
