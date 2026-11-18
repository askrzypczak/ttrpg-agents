import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DatabaseFile,
  DatabaseProbe,
  NewestBackup,
} from "@ttrpg-agents/engine";
import { LATEST_VERSION, getUserVersion } from "./migrations.js";

/**
 * Reads the schema version and stored creature count of the database at `path` read-only; never creates or migrates it.
 * A read-only open of a WAL database that no process has open can leave empty
 * `-wal` and `-shm` files beside it; that is SQLite's own housekeeping, and the
 * next read-write close removes them.
 * `checkBackups` lists `backupDir` and never creates it.
 */
export function createDatabaseProbe(
  path: string,
  backupDir: string,
): DatabaseProbe {
  return {
    check() {
      return { path, expectedVersion: LATEST_VERSION, file: readFile(path) };
    },
    checkBackups() {
      return { dir: backupDir, newest: newestBackup(backupDir) };
    },
  };
}

function readFile(path: string): DatabaseFile {
  if (!existsSync(path)) return { kind: "missing" };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const version = getUserVersion(db);
    const creatureCount = countCreatures(db);
    return creatureCount === undefined
      ? { kind: "found", version }
      : { kind: "found", version, creatureCount };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db?.close();
  }
}

/** The rows of the creatures table, or undefined when the file has none (older than its migration). */
function countCreatures(db: DatabaseSync): number | undefined {
  const table = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'creatures'",
    )
    .get();
  if (table === undefined) return undefined;
  const row = db.prepare("SELECT COUNT(*) AS n FROM creatures").get() as {
    n: number;
  };
  return row.n;
}

const BACKUP_FILE = /^encounters-.*\.db$/;

/** The `encounters-*.db` regular file with the latest modification time (tie: the later name). */
function newestBackup(dir: string): NewestBackup {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && BACKUP_FILE.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ENOENT")
      return { kind: "none" };
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  let best: { name: string; mtimeMs: number; mtime: Date } | undefined;
  for (const name of names) {
    let mtimeMs: number;
    let mtime: Date;
    try {
      ({ mtimeMs, mtime } = statSync(join(dir, name)));
    } catch {
      // Removed between listing and stat: skip it.
      continue;
    }
    if (
      best === undefined ||
      mtimeMs > best.mtimeMs ||
      (mtimeMs === best.mtimeMs && name > best.name)
    )
      best = { name, mtimeMs, mtime };
  }
  return best === undefined
    ? { kind: "none" }
    : {
        kind: "found",
        path: join(dir, best.name),
        takenAt: best.mtime.toISOString(),
      };
}
