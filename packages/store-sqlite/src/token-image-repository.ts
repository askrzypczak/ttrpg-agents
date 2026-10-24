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
    void this.db;
    void image;
    throw new Error("not implemented");
  }

  getTokenImage(sha256: string): TokenImage | undefined {
    void this.db;
    void sha256;
    throw new Error("not implemented");
  }
}
