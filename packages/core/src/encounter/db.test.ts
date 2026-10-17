import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("tolerates another process migrating between the version read and the transaction", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "race.db");
    const a = new DatabaseSync(path, { timeout: 500 });
    a.exec("PRAGMA journal_mode = WAL");
    const b = new DatabaseSync(path, { timeout: 500 });
    let raced = false;
    const racing = new Proxy(a, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        if (prop !== "prepare") return fn.bind(target);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (raced || sql !== "PRAGMA user_version") return stmt;
          return new Proxy(stmt, {
            get(st, p) {
              const v: unknown = Reflect.get(st, p, st);
              if (p !== "get" || typeof v !== "function") {
                return typeof v === "function" ? v.bind(st) : v;
              }
              return (...args: unknown[]) => {
                const row = (v as (...a: unknown[]) => unknown).apply(st, args);
                raced = true;
                migrate(b);
                return row;
              };
            },
          });
        };
      },
    });
    expect(() => migrate(racing)).not.toThrow();
    expect(raced).toBe(true);
    expect(getUserVersion(a)).toBe(LATEST_VERSION);
    expect(a.prepare("SELECT count(*) AS n FROM encounters").get()).toEqual({
      n: 0,
    });
    a.close();
    b.close();
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

  it("falls back to ~/.local/share", () => {
    expect(defaultDbPath({}, "/home/u")).toBe(
      join("/home/u", ".local", "share", "ttrpg-agents", "encounters.db"),
    );
  });

  it("real default is not inside the repo", () => {
    const p = defaultDbPath({}, homedir());
    expect(p).toBe(
      join(homedir(), ".local", "share", "ttrpg-agents", "encounters.db"),
    );
    expect(resolve(p).startsWith(resolve(process.cwd()) + sep)).toBe(false);
  });
});

describe("openDatabase concurrency settings", () => {
  const pragma = (db: DatabaseSync, name: string) =>
    Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];

  it("uses a 5s busy timeout and WAL for file databases", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "enc.db"));
    expect(pragma(db, "busy_timeout")).toBe(5000);
    expect(pragma(db, "journal_mode")).toBe("wal");
    db.close();
  });

  it("keeps in-memory databases out of WAL", () => {
    const db = openDatabase(":memory:");
    expect(pragma(db, "journal_mode")).toBe("memory");
  });

  it("takes the write lock up front so a concurrent writer cannot race getOrCreateActiveEncounter", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const a = openDatabase(path);
    const other = new DatabaseSync(path, { timeout: 0 });
    let otherError: unknown;
    let n = 0;
    const repo = new SqliteEncounterRepository(a, {
      // Called between the SELECT and the INSERT: simulates another process
      // trying to create the active encounter at exactly that moment.
      newId: () => {
        if (++n === 1) {
          try {
            other
              .prepare(
                "INSERT INTO encounters (id, active, created_at) VALUES ('other', 1, 0)",
              )
              .run();
          } catch (err) {
            otherError = err;
          }
        }
        return `id-${n}`;
      },
    });
    const enc = repo.getOrCreateActiveEncounter();
    expect(otherError).toBeDefined();
    expect(enc.id).toBe("id-1");
    expect(a.prepare("SELECT COUNT(*) AS c FROM encounters").get()).toEqual({
      c: 1,
    });
    other.close();
    a.close();
  });
});
