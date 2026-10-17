import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";

export interface PathEnv {
  TTRPG_AGENTS_DB?: string | undefined;
  XDG_DATA_HOME?: string | undefined;
}

/** $TTRPG_AGENTS_DB, else $XDG_DATA_HOME or ~/.local/share, + ttrpg-agents/encounters.db. */
export function defaultDbPath(
  env: PathEnv = process.env,
  home: string = homedir(),
): string {
  if (env.TTRPG_AGENTS_DB) return env.TTRPG_AGENTS_DB;
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(dataHome, "ttrpg-agents", "encounters.db");
}

/** Opens (and migrates) the database. Use ":memory:" for tests. */
export function openDatabase(path: string = defaultDbPath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}
