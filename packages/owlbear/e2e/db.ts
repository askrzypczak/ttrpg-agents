import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";

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
    repo.addInstances(() =>
      SHADOW_IDS.map((_, i) => ({
        monsterKey: "shadow",
        displayName: `Shadow ${i + 1}`,
        maxHp: 16,
      })),
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

/**
 * Puts the 5 seeded shadows back in place. A worker's bridge (and its DB)
 * outlives a test, and specs expect all 5.
 */
export function restoreE2eSeed(dir: string): void {
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
    repo.clearEncounter();
    repo.addInstances(() =>
      SHADOW_IDS.map((_, i) => ({
        monsterKey: "shadow",
        displayName: `Shadow ${i + 1}`,
        maxHp: 16,
      })),
    );
  } finally {
    db.close();
  }
}
