import type { DatabaseSync } from "node:sqlite";
import type { TokenArt, TokenArtRepository } from "@ttrpg-agents/engine";

/** Token art per monster key, in the `token_art` table of the shared database. */
export class SqliteTokenArtRepository implements TokenArtRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  listTokenArt(): Record<string, TokenArt> {
    const rows = this.db
      .prepare(
        "SELECT monster_key, url, mime, width, height, sha256 FROM token_art",
      )
      .all() as ({ monster_key: string; sha256: string | null } & TokenArt)[];
    const art: Record<string, TokenArt> = {};
    for (const row of rows) {
      const value: TokenArt = {
        url: row.url,
        mime: row.mime,
        width: row.width,
        height: row.height,
      };
      if (row.sha256 !== null) value.sha256 = row.sha256;
      art[row.monster_key] = value;
    }
    return art;
  }

  setTokenArt(monsterKey: string, art: TokenArt): void {
    this.db
      .prepare(
        `INSERT INTO token_art (monster_key, url, mime, width, height, sha256)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (monster_key) DO UPDATE SET
           url = excluded.url, mime = excluded.mime, width = excluded.width,
           height = excluded.height, sha256 = excluded.sha256`,
      )
      .run(
        monsterKey,
        art.url,
        art.mime,
        art.width,
        art.height,
        art.sha256 ?? null,
      );
  }
}
