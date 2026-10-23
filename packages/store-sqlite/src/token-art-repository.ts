import type { DatabaseSync } from "node:sqlite";
import type { TokenArt, TokenArtRepository } from "@ttrpg-agents/engine";

/** Token art per monster key, in the `token_art` table of the shared database. */
export class SqliteTokenArtRepository implements TokenArtRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  listTokenArt(): Record<string, TokenArt> {
    void this.db;
    throw new Error("not implemented");
  }

  setTokenArt(monsterKey: string, art: TokenArt): void {
    void monsterKey;
    void art;
    throw new Error("not implemented");
  }
}
