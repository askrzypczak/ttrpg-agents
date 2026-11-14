import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SqliteEncounterDirectory,
  SqliteEncounterRepository,
  SqliteMapRepository,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  nextEncounterName,
  resolveEncounter,
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

/** The id of the seeded encounter. */
export const E2E_ENCOUNTER_ID = "e2e-encounter";

/** The scene the seeded encounter is bound to, and the harness scene's id by default. */
export const E2E_SCENE_ID = "e2e-scene";

/** Deterministic ids so specs can match tokens to instances. */
export const SHADOW_IDS = [1, 2, 3, 4, 5].map((n) => `e2e-shadow-${n}`);

/** Recreates the DB file from scratch with 5 shadows in the current encounter, E2E_ENCOUNTER_ID, bound to E2E_SCENE_ID. */
export function seedE2eDatabase(dir: string): void {
  const dbPath = e2eDbPath(dir);
  mkdirSync(dir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    rmSync(dbPath + suffix, { force: true });
  const db = openDatabase(dbPath);
  try {
    // newId is also used for the encounter row (first call); the rest are shadows.
    const ids = [E2E_ENCOUNTER_ID, ...SHADOW_IDS];
    const directory = new SqliteEncounterDirectory(db, {
      newId: () => ids.shift()!,
    });
    const encounter = resolveEncounter(directory, { writes: true }).encounter;
    directory.bindScene(E2E_SCENE_ID, encounter.id);
    directory.repositoryFor(encounter.id).addInstances(
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

/** Ids of the instances in the e2e DB's seeded encounter, in creation order. */
export function listE2eInstanceIds(dir: string): string[] {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return new SqliteEncounterRepository(db, E2E_ENCOUNTER_ID)
      .listInstances()
      .map((i) => i.id);
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

/** Registers `registration` as the map of the seeded encounter, E2E_ENCOUNTER_ID, and saves `rooms` for its item. */
export function seedE2eMap(
  dir: string,
  registration: MapRegistration,
  rooms: SavedRoom[],
): void {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const maps = new SqliteMapRepository(db, E2E_ENCOUNTER_ID);
    maps.registerMap(registration);
    maps.replaceRooms(registration.itemId, rooms);
  } finally {
    db.close();
  }
}

/** Forgets every registered map and its rooms in the e2e DB, so no map is in use. */
export function clearE2eMap(dir: string): void {
  const db = openDatabase(e2eDbPath(dir));
  try {
    // map_rooms first: its rows refer to the registrations.
    db.exec("DELETE FROM map_rooms");
    db.exec("DELETE FROM map_registrations");
  } finally {
    db.close();
  }
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
 * Seeds another encounter, bound to `sceneId`, with one shadow per name;
 * returns its id and its instances' ids in creation order.
 */
export function seedE2eSceneEncounter(
  dir: string,
  sceneId: string,
  names: string[],
): { encounterId: string; instanceIds: string[] } {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const directory = new SqliteEncounterDirectory(db);
    return directory.transaction(() => {
      const encounter = directory.createEncounter(
        nextEncounterName(directory.listEncounters().map((e) => e.name)),
      );
      directory.bindScene(sceneId, encounter.id);
      const instances = directory.repositoryFor(encounter.id).addInstances(
        () =>
          names.map((displayName) => ({
            monsterKey: "shadow",
            displayName,
            maxHp: 16,
          })),
        origin,
      );
      return {
        encounterId: encounter.id,
        instanceIds: instances.map((i) => i.id),
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Adds one shadow per name as `add_monsters` would: to the encounter a
 * write resolves (in an open scene with none, a new one bound to it);
 * returns that encounter's id.
 */
export function addE2eMonstersInOpenScene(
  dir: string,
  names: string[],
): string {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const directory = new SqliteEncounterDirectory(db);
    const { encounter } = resolveEncounter(directory, { writes: true });
    directory.repositoryFor(encounter.id).addInstances(
      () =>
        names.map((displayName) => ({
          monsterKey: "shadow",
          displayName,
          maxHp: 16,
        })),
      origin,
    );
    return encounter.id;
  } finally {
    db.close();
  }
}

/** The scene id the e2e DB records as open, or undefined when none is. */
export function readE2eOpenScene(dir: string): string | undefined {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return new SqliteEncounterDirectory(db).getOpenScene()?.sceneId;
  } finally {
    db.close();
  }
}

/** Deletes every encounter but the seeded one (their instances and undo records too) and makes it current. */
function removeOtherEncounters(dir: string): void {
  const db = openDatabase(e2eDbPath(dir));
  try {
    const directory = new SqliteEncounterDirectory(db);
    directory.transaction(() => {
      // Children first, though the foreign keys cascade.
      db.prepare(
        "DELETE FROM undo_instances WHERE command_id IN (SELECT command_id FROM undo_commands WHERE encounter_id <> ?)",
      ).run(E2E_ENCOUNTER_ID);
      db.prepare("DELETE FROM undo_commands WHERE encounter_id <> ?").run(
        E2E_ENCOUNTER_ID,
      );
      db.prepare("DELETE FROM monster_instances WHERE encounter_id <> ?").run(
        E2E_ENCOUNTER_ID,
      );
      db.prepare("DELETE FROM encounters WHERE id <> ?").run(E2E_ENCOUNTER_ID);
      directory.setCurrentEncounter(E2E_ENCOUNTER_ID);
    });
  } finally {
    db.close();
  }
}

/**
 * Puts the 5 seeded shadows back in place, deletes every other encounter and
 * forgets any picked token art. A worker's bridge (and its DB) outlives a
 * test, and specs expect all 5 shadows in the only encounter and no art.
 */
export function restoreE2eSeed(dir: string): void {
  clearTokenArt(dir);
  removeOtherEncounters(dir);
  const have = listE2eInstanceIds(dir);
  if (
    have.length === SHADOW_IDS.length &&
    SHADOW_IDS.every((id) => have.includes(id))
  )
    return;
  const db = openDatabase(e2eDbPath(dir));
  try {
    const ids = [...SHADOW_IDS];
    const repo = new SqliteEncounterRepository(db, E2E_ENCOUNTER_ID, {
      newId: () => ids.shift()!,
    });
    repo.clearEncounter(origin);
    // The clear keeps its rows, which would collide with the ids re-added below.
    db.exec("DELETE FROM monster_instances WHERE removed_seq IS NOT NULL");
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
