import type { DatabaseSync } from "node:sqlite";
import type {
  CreatureRecord,
  CreatureRepository,
  Monster,
} from "@ttrpg-agents/engine";

/** Stored creatures in the `creatures` table (migration 20) of the shared database. */
export class SqliteCreatureRepository implements CreatureRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getRecord(key: string): CreatureRecord | undefined {
    void this.db;
    void key;
    throw new Error("not implemented");
  }

  listRecords(): CreatureRecord[] {
    throw new Error("not implemented");
  }

  insert(key: string, monster: Monster): void {
    void key;
    void monster;
    throw new Error("not implemented");
  }

  replace(key: string, monster: Monster): void {
    void key;
    void monster;
    throw new Error("not implemented");
  }

  delete(key: string): void {
    void key;
    throw new Error("not implemented");
  }
}
