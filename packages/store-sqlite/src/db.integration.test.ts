import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { defaultDbPath, openDatabase } from "./db.js";
import {
  LATEST_VERSION,
  getUserVersion,
  migrate,
  migrations,
} from "./migrations.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";

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

  it("a version 1 database migrates to the latest version keeping its instances with a null armorClass", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version === 1)) {
      db.exec(m.sql);
    }
    db.exec("PRAGMA user_version = 1");
    db.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, group_id, created_at)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 9, 12, 'g1', 200)`,
    );

    migrate(db);

    expect(LATEST_VERSION).toBeGreaterThan(1);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    const columns = (
      db.prepare("PRAGMA table_info(monster_instances)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(columns).toContain("armor_class");
    expect(new SqliteEncounterRepository(db).listInstances()).toEqual([
      makeTestInstance({
        currentHp: 9,
        initiative: 12,
        groupId: "g1",
        createdAt: 200,
      }),
    ]);
    db.close();
  });

  it("the migration adds stats_visible defaulting to 0 for existing rows", () => {
    // The schema as it was before instances could reveal their stats.
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 4)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 4");
    db.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 16, NULL, 13, NULL, 200)`,
    );

    migrate(db);

    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    const column = (
      db.prepare("PRAGMA table_info(monster_instances)").all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === "stats_visible");
    expect(column).toMatchObject({ notnull: 1, dflt_value: "0" });
    expect(
      db.prepare("SELECT stats_visible FROM monster_instances").all(),
    ).toEqual([{ stats_visible: 0 }]);
    expect(new SqliteEncounterRepository(db).listInstances()).toEqual([
      makeTestInstance({ armorClass: 13, createdAt: 200, statsVisible: false }),
    ]);
    db.close();
  });

  it("persists data across reopen of a file-backed database", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "enc.db");
    const db1 = openDatabase(path);
    new SqliteEncounterRepository(db1).addInstances(() => [
      { monsterKey: "orc", displayName: "Orc", maxHp: 15 },
    ]);
    db1.close();
    const db2 = openDatabase(path);
    const list = new SqliteEncounterRepository(db2).listInstances();
    expect(list.map((i) => i.displayName)).toEqual(["Orc"]);
    db2.close();
  });

  it("migrating a database at the previous schema version adds token_art and keeps its instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "old.db");
    const tables = (db: DatabaseSync) =>
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name);

    // Build the database as the release before token_art (version 3) left it.
    const previous = 2;
    const old = new DatabaseSync(path);
    for (const m of migrations.filter((m) => m.version <= previous))
      old.exec(m.sql);
    old.exec(`PRAGMA user_version = ${previous}`);
    expect(tables(old)).toContain("monster_instances");
    expect(tables(old)).not.toContain("token_art");
    old.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    old.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, created_at)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 16, 100)`,
    );
    old.close();

    const db = openDatabase(path);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(tables(db)).toContain("token_art");
    expect(
      new SqliteEncounterRepository(db)
        .listInstances()
        .map((i) => i.displayName),
    ).toEqual(["Shadow 1"]);
    expect(new SqliteTokenArtRepository(db).listTokenArt()).toEqual({});
    db.close();
  });

  it("a row stored before migration 4 reads as footprint 1", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 3)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 3");
    db.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 9, 12, 13, 'g1', 200)`,
    );

    migrate(db);

    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(new SqliteEncounterRepository(db).listInstances()).toEqual([
      makeTestInstance({
        currentHp: 9,
        initiative: 12,
        armorClass: 13,
        groupId: "g1",
        createdAt: 200,
        footprint: 1,
      }),
    ]);
    db.close();
  });

  it("the footprint column rejects a value below 1", () => {
    const db = openDatabase(":memory:");
    db.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    const insert = (id: string, footprint: number) =>
      db
        .prepare(
          `INSERT INTO monster_instances
            (id, encounter_id, monster_key, display_name, max_hp, current_hp, created_at, footprint)
           VALUES (?, 'e1', 'ogre', ?, 59, 59, 200, ?)`,
        )
        .run(id, `Ogre ${id}`, footprint);

    let error: unknown;
    try {
      insert("i0", 0);
    } catch (e) {
      error = e;
    }
    // SQLITE_CONSTRAINT_CHECK
    expect(error).toMatchObject({ errcode: 275 });
    insert("i2", 2);
    expect(
      new SqliteEncounterRepository(db)
        .listInstances()
        .map((i) => [i.id, i.footprint]),
    ).toEqual([["i2", 2]]);
    db.close();
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
