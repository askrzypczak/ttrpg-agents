import type { DatabaseSync } from "node:sqlite";
import type { Party, PartyStore } from "@ttrpg-agents/engine";

/** The party's size and level in the `party` table (migration 21) of the shared database: one row or none. */
export class SqlitePartyStore implements PartyStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(): Party | null {
    throw new Error("not implemented");
  }

  set(party: Party): void {
    void party;
    throw new Error("not implemented");
  }
}
