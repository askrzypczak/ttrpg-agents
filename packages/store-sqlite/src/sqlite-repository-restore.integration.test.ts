import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidNameError,
  UnknownInstanceError,
  type ChangeOrigin,
  type MonsterInstance,
  type NewMonsterInstance,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { openDatabase } from "./db.js";
import { migrate, migrations } from "./migrations.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "mcp", commandId: "seed" };
const removeOrigin: ChangeOrigin = { source: "table", commandId: "remove-1" };
const restoreOrigin: ChangeOrigin = { source: "mcp", commandId: "restore-1" };

let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let log: SqliteEncounterLog;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${String(++n)}`,
    now: () => ++t,
  });
  log = new SqliteEncounterLog(db);
});

function shadow(
  displayName: string,
  over: Partial<NewMonsterInstance> = {},
): NewMonsterInstance {
  return { monsterKey: "srd-2024_shadow", displayName, maxHp: 16, ...over };
}

function seed(...items: NewMonsterInstance[]): MonsterInstance[] {
  return repo.addInstances(() => items, seedOrigin);
}

const keepName = (i: MonsterInstance): string => i.displayName;

function liveNames(): string[] {
  return repo.listInstances().map((i) => i.displayName);
}

function removedIds(): string[] {
  return repo.listRemovedInstances().map((r) => r.instance.id);
}

describe("removing keeps the instance for restoring", () => {
  it("removeInstances keeps a removed instance out of listInstances and lists it in listRemovedInstances with its state and the removing origin", () => {
    const [a, b] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2", {
        initiative: 14,
        armorClass: 12,
        groupId: "g1",
        statsVisible: true,
        spawnPosition: { x: 300, y: 450 },
      }),
    );
    const damaged = repo.applyDamage(b!.id, 5, seedOrigin).after;

    repo.removeInstances([b!.id], removeOrigin);

    expect(repo.listInstances().map((i) => i.id)).toEqual([a!.id]);
    expect(repo.listRemovedInstances()).toEqual([
      { instance: damaged, removedBy: removeOrigin, cleared: false },
    ]);
    expect(damaged.currentHp).toBe(11);
  });

  it("listRemovedInstances lists the newest removal first", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );

    repo.removeInstances([b!.id], removeOrigin);
    repo.removeInstances([a!.id], { source: "mcp", commandId: "remove-2" });
    repo.removeInstances([c!.id], { source: "mcp", commandId: "remove-3" });

    expect(removedIds()).toEqual([c!.id, a!.id, b!.id]);
  });

  it("a removed instance is unknown to the mutations by id", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);
    const id = b!.id;

    const mutations: [string, () => unknown][] = [
      ["applyDamage", () => repo.applyDamage(id, 1, seedOrigin)],
      ["applyHealing", () => repo.applyHealing(id, 1, seedOrigin)],
      ["renameInstance", () => repo.renameInstance(id, "Boss", seedOrigin)],
      ["setInitiative", () => repo.setInitiative(id, 5, seedOrigin)],
      ["setHp", () => repo.setHp(id, 3, seedOrigin)],
      ["setMaxHp", () => repo.setMaxHp(id, 30, seedOrigin)],
      ["setArmorClass", () => repo.setArmorClass(id, 15, seedOrigin)],
      ["setStatsVisible", () => repo.setStatsVisible(id, true, seedOrigin)],
      ["removeInstances", () => repo.removeInstances([id], seedOrigin)],
    ];
    for (const [name, mutate] of mutations) {
      expect(mutate, name).toThrow(UnknownInstanceError);
    }

    expect(repo.listInstances().map((i) => i.id)).toEqual([a!.id]);
    expect(repo.listRemovedInstances()).toEqual([
      { instance: b, removedBy: removeOrigin, cleared: false },
    ]);
  });
});

describe("restoreInstances", () => {
  it("restoreInstances puts a removed instance back with its id, HP, initiative, group, stats visibility and spawn position, and records one added event for it", () => {
    const [, b] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2", {
        initiative: 14,
        armorClass: 12,
        groupId: "g1",
        footprint: 2,
        statsVisible: true,
        spawnPosition: { x: 300, y: 450 },
      }),
    );
    const before = repo.applyDamage(b!.id, 5, seedOrigin).after;
    repo.removeInstances([b!.id], removeOrigin);
    const seq = log.latestSeq();

    const restored = repo.restoreInstances([b!.id], keepName, restoreOrigin);

    expect(restored).toEqual([before]);
    expect(repo.listInstances().find((i) => i.id === b!.id)).toEqual(before);
    expect(repo.listRemovedInstances()).toEqual([]);
    expect(log.eventsSince(seq)).toEqual([
      {
        seq: seq + 1,
        event: { type: "added", instances: [before], origin: restoreOrigin },
      },
    ]);
  });

  it("restoreInstances names each instance with the namer from the names in use, including those restored earlier in the same call", () => {
    const [, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.removeInstances([b!.id, c!.id], removeOrigin);
    const seen: string[][] = [];
    const namer = (i: MonsterInstance, namesInUse: readonly string[]) => {
      seen.push([...namesInUse]);
      return `${i.displayName} again`;
    };

    const restored = repo.restoreInstances(
      [c!.id, b!.id],
      namer,
      restoreOrigin,
    );

    expect(seen).toEqual([["Shadow 1"], ["Shadow 1", "Shadow 3 again"]]);
    expect(restored.map((i) => [i.id, i.displayName])).toEqual([
      [c!.id, "Shadow 3 again"],
      [b!.id, "Shadow 2 again"],
    ]);
    expect(liveNames().sort()).toEqual([
      "Shadow 1",
      "Shadow 2 again",
      "Shadow 3 again",
    ]);
  });

  it("restoreInstances with an id that is not a removed instance throws UnknownInstanceError and restores nothing", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.removeInstances([b!.id, c!.id], removeOrigin);
    const removedBefore = repo.listRemovedInstances();
    const seq = log.latestSeq();

    for (const bad of [a!.id, "no-such-id"]) {
      expect(
        () => repo.restoreInstances([b!.id, bad], keepName, restoreOrigin),
        bad,
      ).toThrow(UnknownInstanceError);
    }

    expect(liveNames()).toEqual(["Shadow 1"]);
    expect(repo.listRemovedInstances()).toEqual(removedBefore);
    expect(removedBefore).toHaveLength(2);
    expect(log.eventsSince(seq)).toEqual([]);
  });

  it("restoreInstances with a picked name already in use throws InvalidNameError and restores nothing", () => {
    const [, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.removeInstances([b!.id, c!.id], removeOrigin);
    const removedBefore = repo.listRemovedInstances();
    const seq = log.latestSeq();

    const pickers: [string, (i: MonsterInstance) => string][] = [
      ["a live name", (i) => (i.id === c!.id ? "Shadow 1" : i.displayName)],
      ["the same name twice", () => "Twin"],
      ["an empty name", (i) => (i.id === c!.id ? "  " : i.displayName)],
    ];
    for (const [label, pick] of pickers) {
      expect(
        () => repo.restoreInstances([b!.id, c!.id], pick, restoreOrigin),
        label,
      ).toThrow(InvalidNameError);
    }

    expect(liveNames()).toEqual(["Shadow 1"]);
    expect(repo.listRemovedInstances()).toEqual(removedBefore);
    expect(removedBefore).toHaveLength(2);
    expect(log.eventsSince(seq)).toEqual([]);
  });
});

describe("migration", () => {
  it("a row stored before migration 12 reads as in the encounter", () => {
    const old = new DatabaseSync(":memory:");
    old.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 11)) old.exec(m.sql);
    old.exec("PRAGMA user_version = 11");
    old.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    old.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at, footprint, stats_visible, spawn_x, spawn_y)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 9, 12, 13, 'g1', 200, 1, 0, NULL, NULL)`,
    );

    migrate(old);

    const migrated = new SqliteEncounterRepository(old);
    expect(migrated.listInstances()).toEqual([
      makeTestInstance({
        currentHp: 9,
        initiative: 12,
        armorClass: 13,
        groupId: "g1",
        createdAt: 200,
      }),
    ]);
    expect(migrated.listRemovedInstances()).toEqual([]);
    old.close();
  });
});
