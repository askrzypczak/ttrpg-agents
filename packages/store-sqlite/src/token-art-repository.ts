import type { DatabaseSync } from "node:sqlite";
import type {
  PublishedTokenArt,
  TokenArt,
  TokenArtRepository,
} from "@ttrpg-agents/engine";

/**
 * A `token_art` row. The table's CHECK keeps the reference all or nothing,
 * and a row without it always has a hash.
 */
type TokenArtRow = { monster_key: string; sha256: string | null } & (
  | Omit<PublishedTokenArt, "sha256">
  | { url: null; mime: null; width: null; height: null; sha256: string }
);

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
      .all() as TokenArtRow[];
    const art: Record<string, TokenArt> = {};
    for (const row of rows) {
      if (row.url === null) {
        art[row.monster_key] = { sha256: row.sha256 };
        continue;
      }
      const value: PublishedTokenArt = {
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
        art.url ?? null,
        art.mime ?? null,
        art.width ?? null,
        art.height ?? null,
        art.sha256 ?? null,
      );
  }
}
