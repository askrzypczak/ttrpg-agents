import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { SqlitePartyStore } from "./party-store.js";

const dirs: string[] = [];
const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "ttrpg-party-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

function connect(path: string): DatabaseSync {
  const db = openDatabase(path);
  open.push(db);
  return db;
}

describe("SqlitePartyStore", () => {
  it("SqlitePartyStore returns null when no party is set", () => {
    const store = new SqlitePartyStore(connect(tempDatabasePath()));
    expect(store.get()).toBeNull();
  });

  it("a party set through one SqlitePartyStore is read by a second connection to the same file, and a later set replaces it", () => {
    const path = tempDatabasePath();
    const writer = new SqlitePartyStore(connect(path));
    const reader = new SqlitePartyStore(connect(path));

    writer.set({ size: 4, level: 5 });
    expect(reader.get()).toEqual({ size: 4, level: 5 });

    writer.set({ size: 5, level: 6 });
    expect(reader.get()).toEqual({ size: 5, level: 6 });
    expect(writer.get()).toEqual({ size: 5, level: 6 });
  });
});
