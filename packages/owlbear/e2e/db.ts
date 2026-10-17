import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteEncounterRepository, openDatabase } from "@ttrpg-agents/core";

const DIR = join(tmpdir(), "ttrpg-agents-e2e");

/** Throwaway SQLite file for the e2e bridge (TTRPG_AGENTS_DB); never the real one. */
export const E2E_DB_PATH = join(DIR, "encounter.sqlite");

/** Deterministic ids so specs can match tokens to instances. */
export const SHADOW_IDS = [1, 2, 3, 4, 5].map((n) => `e2e-shadow-${n}`);

/** Recreates the DB file from scratch with 5 shadows in the active encounter. */
export function seedE2eDatabase(): void {
  mkdirSync(DIR, { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    rmSync(E2E_DB_PATH + suffix, { force: true });
  const db = openDatabase(E2E_DB_PATH);
  try {
    // newId is also used for the encounter row (first call); the rest are shadows.
    const ids = ["e2e-encounter", ...SHADOW_IDS];
    const repo = new SqliteEncounterRepository(db, {
      newId: () => ids.shift()!,
    });
    repo.addInstances(
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
