import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  UnknownInstanceError,
  type ChangeOrigin,
  type MonsterInstance,
  type NewMonsterInstance,
  type RemovedInstance,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { openDatabase } from "./db.js";
import { getUserVersion, migrate, migrations } from "./migrations.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "mcp", commandId: "seed" };
const removeOrigin: ChangeOrigin = { source: "table", commandId: "remove-1" };
const clearOrigin: ChangeOrigin = { source: "mcp", commandId: "clear-1" };
const secondClearOrigin: ChangeOrigin = {
  source: "table",
  commandId: "clear-2",
};
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

function clearedBy(
  origin: ChangeOrigin,
  ...instances: MonsterInstance[]
): RemovedInstance[] {
  return instances.map((instance) => ({
    instance,
    removedBy: origin,
    cleared: true,
  }));
}

describe("clearEncounter keeps the cleared set", () => {
  it("clearEncounter returns the cleared instances in creation order and keeps them as removed by the clear, with the clear's origin", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2", {
        initiative: 14,
        armorClass: 12,
        groupId: "g1",
        statsVisible: true,
        spawnPosition: { x: 300, y: 450 },
      }),
      shadow("Shadow 3"),
    );
    const damaged = repo.applyDamage(b!.id, 5, seedOrigin).after;
    const seq = log.latestSeq();

    const cleared = repo.clearEncounter(clearOrigin);

    expect(cleared).toEqual([a, damaged, c]);
    expect(repo.listInstances()).toEqual([]);
    expect(repo.listRemovedInstances()).toEqual(
      clearedBy(clearOrigin, a!, damaged, c!),
    );
    expect(log.eventsSince(seq)).toEqual([
      { seq: seq + 1, event: { type: "cleared", origin: clearOrigin } },
    ]);
  });

  it("clearEncounter purges the instances removed before it, so they cannot be restored", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);

    const cleared = repo.clearEncounter(clearOrigin);

    expect(cleared).toEqual([a]);
    expect(repo.listRemovedInstances()).toEqual(clearedBy(clearOrigin, a!));
    expect(() =>
      repo.restoreInstances([b!.id], keepName, restoreOrigin),
    ).toThrow(UnknownInstanceError);
  });

  it("a second clearEncounter purges the first clear's instances and keeps only its own", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.clearEncounter(clearOrigin);
    const [c] = seed(shadow("Shadow 3"));

    const cleared = repo.clearEncounter(secondClearOrigin);

    expect(cleared).toEqual([c]);
    expect(repo.listRemovedInstances()).toEqual(
      clearedBy(secondClearOrigin, c!),
    );
    for (const gone of [a!, b!]) {
      expect(
        () => repo.restoreInstances([gone.id], keepName, restoreOrigin),
        gone.displayName,
      ).toThrow(UnknownInstanceError);
    }
  });

  it("clearEncounter of an encounter with no live instance keeps what can be restored and returns none", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.clearEncounter(clearOrigin);
    const seq = log.latestSeq();

    const cleared = repo.clearEncounter(secondClearOrigin);

    expect(cleared).toEqual([]);
    expect(repo.listRemovedInstances()).toEqual(clearedBy(clearOrigin, a!, b!));
    expect(log.eventsSince(seq)).toEqual([
      { seq: seq + 1, event: { type: "cleared", origin: secondClearOrigin } },
    ]);
  });

  it("listRemovedInstances lists a removal made after the clear first, marked not cleared, then the cleared instances in creation order", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.clearEncounter(clearOrigin);
    expect(repo.listRemovedInstances()).toEqual(
      clearedBy(clearOrigin, a!, b!, c!),
    );
    // Restored and removed again: an ordinary removal, no longer the clear's.
    const [restoredB] = repo.restoreInstances([b!.id], keepName, restoreOrigin);
    repo.removeInstances([b!.id], removeOrigin);
    const [d] = seed(shadow("Shadow 4"));
    repo.removeInstances([d!.id], removeOrigin);

    expect(repo.listRemovedInstances()).toEqual([
      { instance: d, removedBy: removeOrigin, cleared: false },
      { instance: restoredB, removedBy: removeOrigin, cleared: false },
      ...clearedBy(clearOrigin, a!, c!),
    ]);
  });
});

describe("migration", () => {
  it("an encounter stored before migration 13 reads as never cleared", () => {
    const old = new DatabaseSync(":memory:");
    old.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations.filter((m) => m.version <= 12)) old.exec(m.sql);
    old.exec("PRAGMA user_version = 12");
    old.exec(
      "INSERT INTO encounters (id, active, created_at) VALUES ('e1', 1, 100)",
    );
    old.exec(
      `INSERT INTO monster_instances
        (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at, footprint, stats_visible, spawn_x, spawn_y, removed_seq, removed_source, removed_command_id)
       VALUES ('i1', 'e1', 'shadow', 'Shadow 1', 16, 9, 12, 13, 'g1', 200, 1, 0, NULL, NULL, 7, 'table', 'remove-old')`,
    );

    migrate(old);

    expect(getUserVersion(old)).toBe(13);
    const columns = (
      old.prepare("PRAGMA table_info(encounters)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toContain("cleared_seq");
    expect(
      old.prepare("SELECT cleared_seq FROM encounters WHERE id = 'e1'").get(),
    ).toEqual({ cleared_seq: null });
    const migrated = new SqliteEncounterRepository(old);
    expect(migrated.listRemovedInstances()).toEqual([
      {
        instance: makeTestInstance({
          currentHp: 9,
          initiative: 12,
          armorClass: 13,
          groupId: "g1",
          createdAt: 200,
        }),
        removedBy: { source: "table", commandId: "remove-old" },
        cleared: false,
      },
    ]);
    old.close();
  });
});
