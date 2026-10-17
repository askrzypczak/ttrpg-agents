import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDbPath, openDatabase } from "./db.js";
import { LATEST_VERSION, getUserVersion, migrate } from "./migrations.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("migrations", () => {
  it("brings a fresh database to the latest version", () => {
    const db = openDatabase(":memory:");
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    migrate(db);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
  });

  it("persists data across reopen of a file-backed database", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "enc.db");
    const db1 = openDatabase(path);
    new SqliteEncounterRepository(db1).addInstances([
      { monsterKey: "orc", displayName: "Orc", maxHp: 15 },
    ]);
    db1.close();
    const db2 = openDatabase(path);
    const list = new SqliteEncounterRepository(db2).listInstances();
    expect(list.map((i) => i.displayName)).toEqual(["Orc"]);
    db2.close();
  });
});

describe("defaultDbPath", () => {
  it("honours TTRPG_AGENTS_DB", () => {
    expect(defaultDbPath({ TTRPG_AGENTS_DB: "/tmp/x.db" }, "/home/u")).toBe(
      "/tmp/x.db",
    );
  });

  it("uses XDG_DATA_HOME when set", () => {
    expect(defaultDbPath({ XDG_DATA_HOME: "/xdg" }, "/home/u")).toBe(
      join("/xdg", "ttrpg-agents", "encounters.db"),
    );
  });

  it("falls back to ~/.local/share and is not inside the repo", () => {
    const p = defaultDbPath({}, "/home/u");
    expect(p).toBe(
      join("/home/u", ".local", "share", "ttrpg-agents", "encounters.db"),
    );
    expect(resolve(p).startsWith(resolve(process.cwd()) + sep)).toBe(false);
  });
});
