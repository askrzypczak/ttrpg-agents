import type { DatabaseSync } from "node:sqlite";
import type {
  ChangeOrigin,
  PublishedTokenArt,
  StoredTokenArt,
  TokenArt,
  TokenArtRepository,
  TokenArtSource,
} from "@ttrpg-agents/engine";
import { appendEvent, writeTransaction } from "./change-log-write.js";

/**
 * A `token_art` row. The table's CHECK keeps the reference all or nothing,
 * and a row without it always has a hash.
 */
type TokenArtRow = { monster_key: string; sha256: string | null } & (
  | Omit<PublishedTokenArt, "sha256">
  | { url: null; mime: null; width: null; height: null; sha256: string }
);

/** The art a `token_art` row holds. */
function toArt(row: TokenArtRow): TokenArt {
  if (row.url === null) return { sha256: row.sha256 };
  const value: PublishedTokenArt = {
    url: row.url,
    mime: row.mime,
    width: row.width,
    height: row.height,
  };
  if (row.sha256 !== null) value.sha256 = row.sha256;
  return value;
}

/**
 * Token art per monster key with its source, in the `token_art` table of the
 * shared database. Every write logs an `art-changed` event with no encounter
 * in the same transaction.
 */
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
    for (const row of rows) art[row.monster_key] = toArt(row);
    return art;
  }

  getTokenArt(monsterKey: string): StoredTokenArt | undefined {
    const row = this.db
      .prepare(
        `SELECT monster_key, url, mime, width, height, sha256, source
         FROM token_art WHERE monster_key = ?`,
      )
      .get(monsterKey) as
      (TokenArtRow & { source: TokenArtSource }) | undefined;
    if (row === undefined) return undefined;
    return { art: toArt(row), source: row.source };
  }

  setTokenArt(
    monsterKey: string,
    art: TokenArt,
    source: TokenArtSource,
    origin: ChangeOrigin,
  ): void {
    writeTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO token_art
             (monster_key, url, mime, width, height, sha256, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (monster_key) DO UPDATE SET
             url = excluded.url, mime = excluded.mime, width = excluded.width,
             height = excluded.height, sha256 = excluded.sha256,
             source = excluded.source`,
        )
        .run(
          monsterKey,
          art.url ?? null,
          art.mime ?? null,
          art.width ?? null,
          art.height ?? null,
          art.sha256 ?? null,
          source,
        );
      appendEvent(
        this.db,
        { type: "art-changed", monsterKey, art, origin },
        null,
      );
    });
  }

  transaction<T>(fn: () => T): T {
    return writeTransaction(this.db, fn);
  }
}
