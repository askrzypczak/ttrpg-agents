import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { openDatabase } from "./db.js";
import {
  LATEST_VERSION,
  getUserVersion,
  migrate,
  migrations,
} from "./migrations.js";
import { SqliteEncounterDirectory } from "./sqlite-directory.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";
import {
  listRooms,
  resolveEncounter,
  useMap,
  type ChangeOrigin,
  type TablePort,
} from "@ttrpg-agents/engine";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Applies the migrations after the database's version up to `version` (16 is
 * the last one that keeps existing encounters).
 */
function migrateToVersion(db: DatabaseSync, version: number): void {
  const from = getUserVersion(db);
  for (const m of migrations.filter(
    (m) => m.version > from && m.version <= version,
  ))
    db.exec(m.sql);
  db.exec(`PRAGMA user_version = ${String(version)}`);
}

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

  it("a version 1 database migrates to version 16 keeping its instances with a null armorClass", () => {
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

    migrateToVersion(db, 16);

    expect(LATEST_VERSION).toBeGreaterThan(1);
    expect(getUserVersion(db)).toBe(16);
    const columns = (
      db.prepare("PRAGMA table_info(monster_instances)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect(columns).toContain("armor_class");
    expect(new SqliteEncounterRepository(db, "e1").listInstances()).toEqual([
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

    migrateToVersion(db, 16);

    expect(getUserVersion(db)).toBe(16);
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
    expect(new SqliteEncounterRepository(db, "e1").listInstances()).toEqual([
      makeTestInstance({ armorClass: 13, createdAt: 200, statsVisible: false }),
    ]);
    db.close();
  });

  it("persists data across reopen of a file-backed database", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "enc.db");
    const db1 = openDatabase(path);
    const directory1 = new SqliteEncounterDirectory(db1);
    directory1
      .repositoryFor(resolveEncounter(directory1).id)
      .addInstances(
        () => [{ monsterKey: "orc", displayName: "Orc", maxHp: 15 }],
        origin,
      );
    db1.close();
    const db2 = openDatabase(path);
    const directory2 = new SqliteEncounterDirectory(db2);
    const list = directory2
      .repositoryFor(directory2.getCurrentEncounter()!.id)
      .listInstances();
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

    const db = new DatabaseSync(path);
    migrateToVersion(db, 16);
    expect(getUserVersion(db)).toBe(16);
    expect(tables(db)).toContain("token_art");
    expect(
      new SqliteEncounterRepository(db, "e1")
        .listInstances()
        .map((i) => i.displayName),
    ).toEqual(["Shadow 1"]);
    expect(new SqliteTokenArtRepository(db).listTokenArt()).toEqual({});
    db.close();
  });

  it("the image table has no monster column and no foreign key", () => {
    const db = openDatabase(":memory:");
    const columns = (
      db.prepare("PRAGMA table_info(token_art_image)").all() as {
        name: string;
      }[]
    ).map((c) => c.name);
    expect([...columns].sort()).toEqual(
      ["bytes", "height", "mime", "sha256", "width"].sort(),
    );
    expect(columns.some((name) => /monster/i.test(name))).toBe(false);
    expect(
      db.prepare("PRAGMA foreign_key_list(token_art_image)").all(),
    ).toEqual([]);
    db.close();
  });

  it("a version 5 database with art migrates to the latest version keeping its art rows without an image hash", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 5)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 5");
    db.exec(
      `INSERT INTO token_art (monster_key, url, mime, width, height)
       VALUES ('shadow', 'https://cdn.owlbear.rodeo/assets/shadow.png', 'image/png', 300, 280)`,
    );

    migrate(db);

    expect(LATEST_VERSION).toBeGreaterThan(5);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    const listed = new SqliteTokenArtRepository(db).listTokenArt();
    expect(listed).toEqual({
      shadow: {
        url: "https://cdn.owlbear.rodeo/assets/shadow.png",
        mime: "image/png",
        width: 300,
        height: 280,
      },
    });
    expect(Object.keys(listed.shadow ?? {})).not.toContain("sha256");
    db.close();
  });

  it("a version 7 database migrates to the latest version keeping its art rows with and without an image hash", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 7)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 7");
    const sha256 = "ab".repeat(32);
    db.prepare(
      `INSERT INTO token_art_image (sha256, mime, width, height, bytes)
       VALUES (?, 'image/png', 1, 1, ?)`,
    ).run(sha256, new Uint8Array([1, 2, 3]));
    db.exec(
      `INSERT INTO token_art (monster_key, url, mime, width, height)
       VALUES ('shadow', 'https://cdn.owlbear.rodeo/assets/shadow.png', 'image/png', 300, 280)`,
    );
    db.prepare(
      `INSERT INTO token_art (monster_key, url, mime, width, height, sha256)
       VALUES ('ghoul', 'https://cdn.owlbear.rodeo/assets/ghoul.webp', 'image/webp', 512, 512, ?)`,
    ).run(sha256);

    migrate(db);

    expect(LATEST_VERSION).toBeGreaterThan(7);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    const repo = new SqliteTokenArtRepository(db);
    const listed = repo.listTokenArt();
    expect(listed).toEqual({
      shadow: {
        url: "https://cdn.owlbear.rodeo/assets/shadow.png",
        mime: "image/png",
        width: 300,
        height: 280,
      },
      ghoul: {
        url: "https://cdn.owlbear.rodeo/assets/ghoul.webp",
        mime: "image/webp",
        width: 512,
        height: 512,
        sha256,
      },
    });
    expect(Object.keys(listed.shadow ?? {})).not.toContain("sha256");
    // The migrated table takes art with only a hash, and still checks the
    // hash against the stored images.
    repo.setTokenArt("wight", { sha256 });
    expect(repo.listTokenArt().wight).toEqual({ sha256 });
    let error: unknown;
    try {
      repo.setTokenArt("ghast", { sha256: "cd".repeat(32) });
    } catch (e) {
      error = e;
    }
    // SQLITE_CONSTRAINT_FOREIGNKEY
    expect(error).toMatchObject({ errcode: 787 });
    db.close();
  });

  it("the token_art table refuses a row with neither a url nor an image hash", () => {
    const db = openDatabase(":memory:");
    let error: unknown;
    try {
      db.exec("INSERT INTO token_art (monster_key) VALUES ('shadow')");
    } catch (e) {
      error = e;
    }
    // SQLITE_CONSTRAINT_CHECK
    expect(error).toMatchObject({ errcode: 275 });
    expect(new SqliteTokenArtRepository(db).listTokenArt()).toEqual({});
    db.close();
  });

  it("the token_art table refuses a row with only part of url, mime, width and height", () => {
    const db = openDatabase(":memory:");
    const sha256 = "ab".repeat(32);
    db.prepare(
      `INSERT INTO token_art_image (sha256, mime, width, height, bytes)
       VALUES (?, 'image/png', 1, 1, ?)`,
    ).run(sha256, new Uint8Array([1, 2, 3]));
    const full: Record<string, string | number> = {
      url: "https://cdn.owlbear.rodeo/assets/shadow.png",
      mime: "image/png",
      width: 300,
      height: 280,
    };
    const insert = (monsterKey: string, columns: string[]) =>
      db
        .prepare(
          `INSERT INTO token_art (monster_key, sha256${columns.map((c) => `, ${c}`).join("")})
           VALUES (?, ?${columns.map(() => ", ?").join("")})`,
        )
        .run(monsterKey, sha256, ...columns.map((c) => full[c] ?? null));
    const partials = [
      ["url"],
      ["mime", "width", "height"],
      ["url", "mime", "width"],
      ["url", "height"],
    ];
    for (const columns of partials) {
      let error: unknown;
      try {
        insert(columns.join("-"), columns);
      } catch (e) {
        error = e;
      }
      // SQLITE_CONSTRAINT_CHECK
      expect(error, columns.join(",")).toMatchObject({ errcode: 275 });
    }
    expect(new SqliteTokenArtRepository(db).listTokenArt()).toEqual({});
    // Control: the hash alone, or with the whole reference, is stored.
    insert("hash-only", []);
    insert("published", ["url", "mime", "width", "height"]);
    expect(
      Object.keys(new SqliteTokenArtRepository(db).listTokenArt()).sort(),
    ).toEqual(["hash-only", "published"]);
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

    migrateToVersion(db, 16);

    expect(getUserVersion(db)).toBe(16);
    expect(new SqliteEncounterRepository(db, "e1").listInstances()).toEqual([
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
      "INSERT INTO encounters (id, name, active, created_at) VALUES ('e1', 'Encounter 1', 1, 100)",
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
      new SqliteEncounterRepository(db, "e1")
        .listInstances()
        .map((i) => [i.id, i.footprint]),
    ).toEqual([["i2", 2]]);
    db.close();
  });

  it("a row stored before migration 11 reads with no spawn position", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 10)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 10");
    db.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at, footprint, stats_visible)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 9, 12, 13, 'g1', 200, 1, 0)`,
    );

    migrateToVersion(db, 16);

    const instances = new SqliteEncounterRepository(db, "e1").listInstances();
    expect(instances[0]?.spawnPosition).toBeNull();
    expect(instances).toEqual([
      makeTestInstance({
        currentHp: 9,
        initiative: 12,
        armorClass: 13,
        groupId: "g1",
        createdAt: 200,
        spawnPosition: null,
      }),
    ]);
    db.close();
  });

  it("a version 15 database migrates keeping its change-log rows and their seqs, each with a null encounter id", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 15)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 15");
    const cleared = { type: "cleared", origin };
    const removed = { type: "removed", id: "i1", origin };
    const insert = db.prepare(
      "INSERT INTO encounter_events (seq, event) VALUES (?, ?)",
    );
    insert.run(4, JSON.stringify(removed));
    insert.run(9, JSON.stringify(cleared));

    migrate(db);

    expect(new SqliteEncounterLog(db).eventsSince(0)).toEqual([
      { seq: 4, encounterId: null, event: removed },
      { seq: 9, encounterId: null, event: cleared },
    ]);
    db.close();
  });

  it("the spawn columns refuse a row with only one of x and y", () => {
    const db = openDatabase(":memory:");
    db.exec(
      "INSERT INTO encounters (id, name, active, created_at) VALUES ('e1', 'Encounter 1', 1, 100)",
    );
    const insert = (id: string, x: number | null, y: number | null) =>
      db
        .prepare(
          `INSERT INTO monster_instances
            (id, encounter_id, monster_key, display_name, max_hp, current_hp, created_at, spawn_x, spawn_y)
           VALUES (?, 'e1', 'ogre', ?, 59, 59, 200, ?, ?)`,
        )
        .run(id, `Ogre ${id}`, x, y);

    for (const [id, x, y] of [
      ["i1", 225, null],
      ["i2", null, 375],
    ] as const) {
      let error: unknown;
      try {
        insert(id, x, y);
      } catch (e) {
        error = e;
      }
      // SQLITE_CONSTRAINT_CHECK
      expect(error).toMatchObject({ errcode: 275 });
    }
    insert("i3", 225, 375);
    expect(
      new SqliteEncounterRepository(db, "e1")
        .listInstances()
        .map((i) => [i.id, i.spawnPosition]),
    ).toEqual([["i3", { x: 225, y: 375 }]]);
    db.close();
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

  it("takes the write lock up front so a concurrent writer cannot race the creation of the current encounter", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-db-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const a = openDatabase(path);
    const other = new DatabaseSync(path, { timeout: 0 });
    let otherError: unknown;
    let n = 0;
    const directory = new SqliteEncounterDirectory(a, {
      // Called between the read and the INSERT: simulates another process
      // trying to create the current encounter at exactly that moment.
      newId: () => {
        if (++n === 1) {
          try {
            other
              .prepare(
                "INSERT INTO encounters (id, name, active, created_at) VALUES ('other', 'Other', 1, 0)",
              )
              .run();
          } catch (err) {
            otherError = err;
          }
        }
        return `id-${n}`;
      },
    });
    const enc = resolveEncounter(directory);
    expect(otherError).toBeDefined();
    expect(enc.id).toBe("id-1");
    expect(a.prepare("SELECT COUNT(*) AS c FROM encounters").get()).toEqual({
      c: 1,
    });
    other.close();
    a.close();
  });
});

describe("migration to scene-bound encounters", () => {
  /** A database at version 16 with one encounter, its instances, an undo record, log rows and a map with a room. */
  function version16Database(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 16)) db.exec(m.sql);
    db.exec("PRAGMA user_version = 16");
    db.exec(
      "INSERT INTO encounters (id, active, created_at, cleared_seq) VALUES ('e1', 1, 100, 9)",
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, created_at)
       VALUES ('live', 'e1', 'ogre', 'Ogre 1', 59, 59, 200)`,
    );
    db.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, created_at,
         removed_seq, removed_source, removed_command_id)
       VALUES ('gone', 'e1', 'ogre', 'Ogre 2', 59, 59, 201, 9, 'mcp', 'c1')`,
    );
    db.exec(
      "INSERT INTO undo_commands (command_id, encounter_id, command, base_seq) VALUES ('c1', 'e1', 'remove_monsters', 3)",
    );
    db.exec(
      "INSERT INTO undo_instances (command_id, instance_id, before) VALUES ('c1', 'gone', NULL)",
    );
    const insertEvent = db.prepare(
      "INSERT INTO encounter_events (seq, event, encounter_id) VALUES (?, ?, 'e1')",
    );
    insertEvent.run(4, JSON.stringify({ type: "removed", id: "gone", origin }));
    insertEvent.run(9, JSON.stringify({ type: "cleared", origin }));
    db.exec(
      `INSERT INTO map_registrations
        (item_id, name, position_x, position_y, rotation, scale_x, scale_y,
         image_offset_x, image_offset_y, image_width, image_height, image_dpi, scene_dpi, active)
       VALUES ('map-1', 'Cave', 0, 0, 0, 1, 1, 0, 0, 1000, 800, 150, 150, 1)`,
    );
    db.exec(
      `INSERT INTO map_rooms (map_item_id, name, status, polygons, position)
       VALUES ('map-1', 'Hall', 'confirmed', '[]', 0)`,
    );
    return db;
  }

  const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

  it("a version 16 database migrates deleting every encounter, instance and undo record, keeping the change-log rows with their seqs and a null encounter id and the map registrations with their rooms", () => {
    const db = version16Database();
    const maps = rows(db, "SELECT * FROM map_registrations");
    const rooms = rows(db, "SELECT * FROM map_rooms");

    migrateToVersion(db, 17);

    expect(getUserVersion(db)).toBe(17);
    expect(new SqliteEncounterDirectory(db).listEncounters()).toEqual([]);
    expect(rows(db, "SELECT id FROM encounters")).toEqual([]);
    expect(rows(db, "SELECT id FROM monster_instances")).toEqual([]);
    expect(rows(db, "SELECT command_id FROM undo_commands")).toEqual([]);
    expect(rows(db, "SELECT command_id FROM undo_instances")).toEqual([]);
    expect(new SqliteEncounterLog(db).eventsSince(0)).toEqual([
      {
        seq: 4,
        encounterId: null,
        event: { type: "removed", id: "gone", origin },
      },
      { seq: 9, encounterId: null, event: { type: "cleared", origin } },
    ]);
    expect(rows(db, "SELECT * FROM map_registrations")).toEqual(maps);
    expect(rows(db, "SELECT * FROM map_rooms")).toEqual(rooms);
    db.close();
  });

  it('after the migration the next encounter write creates "Encounter 1" and logs its event above the old seqs', () => {
    const db = version16Database();
    migrate(db);
    const directory = new SqliteEncounterDirectory(db);

    const encounter = resolveEncounter(directory);
    const [added] = directory
      .repositoryFor(encounter.id)
      .addInstances(
        () => [{ monsterKey: "ogre", displayName: "Ogre 1", maxHp: 59 }],
        origin,
      );

    expect(encounter.name).toBe("Encounter 1");
    expect(directory.getCurrentEncounter()).toEqual(encounter);
    expect(directory.listEncounters()).toEqual([encounter]);
    const events = new SqliteEncounterLog(db).eventsSince(9);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      encounterId: encounter.id,
      event: { type: "added", instances: [added] },
    });
    expect(events[0]!.seq).toBeGreaterThan(9);
    db.close();
  });
});

describe("migration to per-encounter maps", () => {
  /** A database at version 17 with one current encounter and a map registration, still flagged active, with a room. */
  function version17Database(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateToVersion(db, 17);
    db.exec(
      "INSERT INTO encounters (id, name, active, created_at) VALUES ('e1', 'Tavern', 1, 100)",
    );
    db.exec(
      `INSERT INTO map_registrations
        (item_id, name, position_x, position_y, rotation, scale_x, scale_y,
         image_offset_x, image_offset_y, image_width, image_height, image_dpi, scene_dpi, active)
       VALUES ('map-1', 'Cave', 0, 0, 0, 1, 1, 0, 0, 1500, 1200, 150, 150, 1)`,
    );
    db.exec(
      `INSERT INTO map_rooms (map_item_id, name, status, polygons, position)
       VALUES ('map-1', 'Hall', 'confirmed',
               '[[{"x":0,"y":0},{"x":300,"y":0},{"x":300,"y":150},{"x":0,"y":150}]]', 0)`,
    );
    return db;
  }

  const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all();
  const columns = (db: DatabaseSync, table: string): unknown[] =>
    rows(db, `PRAGMA table_info(${table})`).map((c) => c["name"]);

  it("a version 17 database migrates keeping its map registrations and their rooms without the active flag, and its encounter has no map", () => {
    const db = version17Database();
    const maps = rows(db, "SELECT * FROM map_registrations").map((row) => {
      const kept = { ...row };
      delete kept["active"];
      return kept;
    });
    const rooms = rows(db, "SELECT * FROM map_rooms");

    migrate(db);

    expect(getUserVersion(db)).toBe(18);
    expect(rows(db, "SELECT * FROM map_registrations")).toEqual(maps);
    expect(rows(db, "SELECT * FROM map_rooms")).toEqual(rooms);
    expect(columns(db, "map_registrations")).not.toContain("active");
    expect(columns(db, "encounters")).toContain("map_item_id");
    expect(rows(db, "SELECT id, map_item_id FROM encounters")).toEqual([
      { id: "e1", map_item_id: null },
    ]);
    expect(
      new SqliteEncounterDirectory(db).mapRepositoryFor("e1").getActiveMap(),
    ).toBeUndefined();
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });

  it("after migration 18, use_map in a new encounter on a registered map item lists that item's saved rooms", async () => {
    const db = version17Database();
    migrate(db);
    const directory = new SqliteEncounterDirectory(db);
    const table: Pick<TablePort, "sceneMap"> = {
      sceneMap: () =>
        Promise.resolve({
          grid: { dpi: 150, type: "SQUARE" },
          maps: [
            {
              id: "map-1",
              name: "Cave",
              imageWidth: 1500,
              imageHeight: 1200,
              imageDpi: 150,
              imageOffset: { x: 0, y: 0 },
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 1, y: 1 },
            },
          ],
        }),
    };
    const encounter = directory.createEncounter("Cave fight");
    const maps = directory.mapRepositoryFor(encounter.id);

    await useMap(table, maps);
    const listed = await listRooms(table, maps);

    expect(listed.map.itemId).toBe("map-1");
    expect(listed.rooms.map((room) => [room.name, room.status])).toEqual([
      ["Hall", "confirmed"],
    ]);
    db.close();
  });
});

describe("migration to scene bindings", () => {
  it("a version 18 database migrates keeping its encounters and the current one, with no scene bound and none open", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrateToVersion(db, 18);
    db.exec(
      "INSERT INTO encounters (id, name, active, created_at) VALUES ('e1', 'Tavern', 1, 100)",
    );
    db.exec(
      "INSERT INTO encounters (id, name, active, created_at) VALUES ('e2', 'Cave', 0, 200)",
    );

    migrate(db);

    expect(getUserVersion(db)).toBe(19);
    const directory = new SqliteEncounterDirectory(db);
    const tavern = { id: "e1", name: "Tavern", createdAt: 100 };
    const cave = { id: "e2", name: "Cave", createdAt: 200 };
    expect(directory.listEncounters()).toEqual([tavern, cave]);
    expect(directory.getCurrentEncounter()).toEqual(tavern);
    expect(directory.getOpenScene()).toBeUndefined();
    // Every encounter is free to bind, so none was bound by the migration.
    directory.bindScene("scene-1", "e1");
    directory.bindScene("scene-2", "e2");
    directory.setOpenScene("scene-3");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-3",
      encounter: undefined,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
