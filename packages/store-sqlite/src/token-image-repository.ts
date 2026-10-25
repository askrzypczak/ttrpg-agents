import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  NewTokenImage,
  TokenImage,
  TokenImageRepository,
} from "@ttrpg-agents/engine";

/** Token image bytes by SHA-256, in the `token_art_image` table of the shared database. */
export class SqliteTokenImageRepository implements TokenImageRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  saveTokenImage(image: NewTokenImage): string {
    const sha256 = createHash("sha256").update(image.bytes).digest("hex");
    this.db
      .prepare(
        `INSERT INTO token_art_image (sha256, mime, width, height, bytes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (sha256) DO NOTHING`,
      )
      .run(sha256, image.mime, image.width, image.height, image.bytes);
    return sha256;
  }

  getTokenImage(sha256: string): TokenImage | undefined {
    return this.db
      .prepare(
        "SELECT sha256, mime, width, height, bytes FROM token_art_image WHERE sha256 = ?",
      )
      .get(sha256) as TokenImage | undefined;
  }
}
