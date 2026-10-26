import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  storeTokenImage,
  type ChangeOrigin,
  type MapRegistration,
  type PublishedTokenArt,
  type SavedRoom,
  type TokenArt,
  type TokenImage,
} from "@ttrpg-agents/engine";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

/** Throwaway SQLite file in `dir` for an e2e bridge (TTRPG_AGENTS_DB); never the real one. */
export function e2eDbPath(dir: string): string {
  return join(dir, "encounter.sqlite");
}

/** Deterministic ids so specs can match tokens to instances. */
export const SHADOW_IDS = [1, 2, 3, 4, 5].map((n) => `e2e-shadow-${n}`);

/** Recreates the DB file from scratch with 5 shadows in the active encounter. */
export function seedE2eDatabase(dir: string): void {
  const dbPath = e2eDbPath(dir);
  mkdirSync(dir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    rmSync(dbPath + suffix, { force: true });
  const db = openDatabase(dbPath);
  try {
    // newId is also used for the encounter row (first call); the rest are shadows.
    const ids = ["e2e-encounter", ...SHADOW_IDS];
    const repo = new SqliteEncounterRepository(db, {
      newId: () => ids.shift()!,
    });
    repo.addInstances(
      () =>
        SHADOW_IDS.map((_, i) => ({
          monsterKey: "shadow",
          displayName: `Shadow ${i + 1}`,
          maxHp: 16,
          initiative: 14,
        })),
      origin,
    );
  } finally {
    db.close();
  }
}

/** Ids of the instances in the e2e DB's active encounter, in creation order. */
export function listE2eInstanceIds(dir: string): string[] {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return new SqliteEncounterRepository(db).listInstances().map((i) => i.id);
  } finally {
    db.close();
  }
}

/** Forgets all picked token art, so the next test starts with none. */
function clearTokenArt(dir: string): void {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const table = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_art'",
      )
      .get();
    if (table) db.exec("DELETE FROM token_art");
    // After token_art, whose rows refer to the images.
    const images = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_art_image'",
      )
      .get();
    if (images) db.exec("DELETE FROM token_art_image");
  } finally {
    db.close();
  }
}

/** Registers `registration` as the active map in the e2e DB and saves `rooms` for its item. */
export function seedE2eMap(
  dir: string,
  registration: MapRegistration,
  rooms: SavedRoom[],
): void {
  void dir;
  void registration;
  void rooms;
  throw new Error("not implemented");
}

/** Forgets every registered map and its rooms in the e2e DB, so no map is in use. */
export function clearE2eMap(dir: string): void {
  void dir;
  throw new Error("not implemented");
}

/** The token art stored in the e2e DB, by monster key. */
export function readE2eTokenArt(dir: string): Record<string, TokenArt> {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return new SqliteTokenArtRepository(db).listTokenArt();
  } finally {
    db.close();
  }
}

/**
 * Stores `bytes` as a token image in the e2e DB and sets the art of
 * `monsterKey` to `art` with their hash, or to only their hash (no url) when
 * `art` is `null`; returns the hash. Call it after the auto `seed` fixture,
 * which forgets all art.
 */
export function seedE2eTokenArt(
  dir: string,
  monsterKey: string,
  art: Omit<PublishedTokenArt, "sha256"> | null,
  bytes: Uint8Array,
): string {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const stored = storeTokenImage(new SqliteTokenImageRepository(db), bytes);
    if (!stored.ok)
      throw new Error(`seeding token image failed: ${stored.message}`);
    new SqliteTokenArtRepository(db).setTokenArt(
      monsterKey,
      art === null
        ? { sha256: stored.sha256 }
        : { ...art, sha256: stored.sha256 },
    );
    return stored.sha256;
  } finally {
    db.close();
  }
}

/** The token image stored in the e2e DB under that hash, or undefined. */
export function readE2eTokenImage(
  dir: string,
  sha256: string,
): TokenImage | undefined {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return new SqliteTokenImageRepository(db).getTokenImage(sha256);
  } finally {
    db.close();
  }
}

/**
 * Puts the 5 seeded shadows back in place and forgets any picked token art.
 * A worker's bridge (and its DB) outlives a test, and specs expect all 5
 * shadows and no art.
 */
export function restoreE2eSeed(dir: string): void {
  clearTokenArt(dir);
  const have = listE2eInstanceIds(dir);
  if (
    have.length === SHADOW_IDS.length &&
    SHADOW_IDS.every((id) => have.includes(id))
  )
    return;
  const db = openDatabase(e2eDbPath(dir));
  try {
    const ids = [...SHADOW_IDS];
    const repo = new SqliteEncounterRepository(db, {
      newId: () => ids.shift()!,
    });
    repo.clearEncounter(origin);
    repo.addInstances(
      () =>
        SHADOW_IDS.map((_, i) => ({
          monsterKey: "shadow",
          displayName: `Shadow ${i + 1}`,
          maxHp: 16,
        })),
      origin,
    );
  } finally {
    db.close();
  }
}
