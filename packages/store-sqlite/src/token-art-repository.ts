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
        "SELECT monster_key, url, mime, width, height, dpi, offset_x, offset_y FROM token_art",
      )
      .all() as {
      monster_key: string;
      url: string;
      mime: string;
      width: number;
      height: number;
      dpi: number;
      offset_x: number;
      offset_y: number;
    }[];
    const art: Record<string, TokenArt> = {};
    for (const row of rows)
      art[row.monster_key] = {
        image: {
          url: row.url,
          mime: row.mime,
          width: row.width,
          height: row.height,
        },
        grid: { dpi: row.dpi, offset: { x: row.offset_x, y: row.offset_y } },
      };
    return art;
  }

  setTokenArt(monsterKey: string, art: TokenArt): void {
    this.db
      .prepare(
        `INSERT INTO token_art (monster_key, url, mime, width, height, dpi, offset_x, offset_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (monster_key) DO UPDATE SET
           url = excluded.url, mime = excluded.mime, width = excluded.width,
           height = excluded.height, dpi = excluded.dpi,
           offset_x = excluded.offset_x, offset_y = excluded.offset_y`,
      )
      .run(
        monsterKey,
        art.image.url,
        art.image.mime,
        art.image.width,
        art.image.height,
        art.grid.dpi,
        art.grid.offset.x,
        art.grid.offset.y,
      );
  }
}
