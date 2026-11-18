import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMonsterIndex,
  searchMonsters,
  type Monster,
  type MonsterSet,
} from "@ttrpg-agents/engine";
import { makeTestMonster } from "@ttrpg-agents/engine/testing";
import { SqliteCreatureRepository } from "./creature-repository.js";
import { openDatabase } from "./db.js";

const dirs: string[] = [];
const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "ttrpg-creatures-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

function connect(path: string): DatabaseSync {
  const db = openDatabase(path);
  open.push(db);
  return db;
}

function creature(key: string, name: string, book = "homebrew"): Monster {
  return makeTestMonster({ key, name, source: { book } });
}

const thornling = creature("homebrew_thornling", "Thornling");
const mossback = creature("homebrew_mossback", "Mossback");

describe("SqliteCreatureRepository", () => {
  it("SqliteCreatureRepository returns an inserted creature from getRecord and listRecords as its key and its statblock as parsed JSON, listRecords in key order", () => {
    const repo = new SqliteCreatureRepository(connect(tempDatabasePath()));
    repo.insert(thornling.key, thornling);
    repo.insert(mossback.key, mossback);

    expect(repo.getRecord("homebrew_thornling")).toEqual({
      key: "homebrew_thornling",
      data: thornling,
    });
    expect(repo.getRecord("homebrew_nobody")).toBeUndefined();
    expect(repo.listRecords()).toEqual([
      { key: "homebrew_mossback", data: mossback },
      { key: "homebrew_thornling", data: thornling },
    ]);
  });

  it("SqliteCreatureRepository insert throws when the key exists and keeps the first record", () => {
    const repo = new SqliteCreatureRepository(connect(tempDatabasePath()));
    repo.insert(thornling.key, thornling);
    const renamed = { ...thornling, name: "Thornling Elder" };

    expect(() => repo.insert(thornling.key, renamed)).toThrow();
    expect(repo.listRecords()).toEqual([
      { key: "homebrew_thornling", data: thornling },
    ]);
  });

  it("SqliteCreatureRepository replace overwrites a record and throws when no record has the key", () => {
    const repo = new SqliteCreatureRepository(connect(tempDatabasePath()));
    repo.insert(thornling.key, thornling);
    const edited = { ...thornling, ac: 13 };

    repo.replace(thornling.key, edited);

    expect(repo.getRecord(thornling.key)).toEqual({
      key: "homebrew_thornling",
      data: edited,
    });
    expect(() => repo.replace(mossback.key, mossback)).toThrow();
    expect(repo.listRecords()).toEqual([
      { key: "homebrew_thornling", data: edited },
    ]);
  });

  it("SqliteCreatureRepository delete removes a record and does nothing when no record has the key", () => {
    const repo = new SqliteCreatureRepository(connect(tempDatabasePath()));
    repo.insert(thornling.key, thornling);
    repo.insert(mossback.key, mossback);

    repo.delete(thornling.key);
    repo.delete("homebrew_nobody");

    expect(repo.getRecord(thornling.key)).toBeUndefined();
    expect(repo.listRecords()).toEqual([
      { key: "homebrew_mossback", data: mossback },
    ]);
  });

  it("the creatures table refuses data that is not valid JSON", () => {
    const db = connect(tempDatabasePath());
    const repo = new SqliteCreatureRepository(db);
    repo.insert(thornling.key, thornling);

    expect(() =>
      db
        .prepare("INSERT INTO creatures (key, data) VALUES (?, ?)")
        .run("homebrew_mossback", "{not json"),
    ).toThrow(/CHECK/i);
    expect(repo.listRecords()).toEqual([
      { key: "homebrew_thornling", data: thornling },
    ]);
  });

  it("a creature inserted by one SqliteCreatureRepository is returned by get and searchMonsters on an index built over a second connection to the same file, without rebuilding the index", () => {
    const path = tempDatabasePath();
    const writer = connect(path);
    const reader = connect(path);
    const shadow = creature("srd-2024_shadow", "Shadow", "srd-5.2");
    const builtIn: MonsterSet = {
      monsters: [shadow],
      byKey: new Map([[shadow.key, shadow]]),
      aliases: new Map(),
      dndBeyondPages: new Map(),
    };
    const index = createMonsterIndex(
      builtIn,
      new SqliteCreatureRepository(reader),
    );
    expect(index.get(thornling.key)).toBeUndefined();

    new SqliteCreatureRepository(writer).insert(thornling.key, thornling);

    expect(index.get(thornling.key)).toEqual(thornling);
    expect(
      searchMonsters(index, "thornling").map((r) => r.monster.key),
    ).toEqual(["homebrew_thornling"]);
  });
});
