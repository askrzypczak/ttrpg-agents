import type { DatabaseSync } from "node:sqlite";
import type { Party, PartyStore } from "@ttrpg-agents/engine";

type PartyRow = { size: number; level: number } | undefined;

/** The party's size and level in the `party` table (migration 21) of the shared database: one row or none. */
export class SqlitePartyStore implements PartyStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(): Party | null {
    const row = this.db
      .prepare("SELECT size, level FROM party WHERE id = 1")
      .get() as PartyRow;
    if (row === undefined) return null;
    return { size: row.size, level: row.level };
  }

  set(party: Party): void {
    this.db
      .prepare(
        `INSERT INTO party (id, size, level) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET size = excluded.size, level = excluded.level`,
      )
      .run(party.size, party.level);
  }
}
