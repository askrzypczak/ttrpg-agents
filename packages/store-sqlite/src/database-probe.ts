import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseFile, DatabaseProbe } from "@ttrpg-agents/engine";
import { LATEST_VERSION, getUserVersion } from "./migrations.js";

/**
 * Reads the schema version of the database at `path` read-only; never creates or migrates it.
 * A read-only open of a WAL database that no process has open can leave empty
 * `-wal` and `-shm` files beside it; that is SQLite's own housekeeping, and the
 * next read-write close removes them.
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
      void backupDir;
      throw new Error("not implemented");
    },
  };
}

function readFile(path: string): DatabaseFile {
  if (!existsSync(path)) return { kind: "missing" };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return { kind: "found", version: getUserVersion(db) };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db?.close();
  }
}
