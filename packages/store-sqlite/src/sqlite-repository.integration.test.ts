import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.js";
import { InvalidAmountError, UnknownInstanceError } from "@ttrpg-agents/engine";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

let db: DatabaseSync;
let repo: SqliteEncounterRepository;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
});

const goblin = (over = {}) => ({
  monsterKey: "goblin",
  displayName: "Goblin",
  maxHp: 7,
  ...over,
});

describe("getOrCreateActiveEncounter", () => {
  it("creates once and returns the same encounter afterwards", () => {
    const a = repo.getOrCreateActiveEncounter();
    const b = repo.getOrCreateActiveEncounter();
    expect(b).toEqual(a);
    expect(db.prepare("SELECT COUNT(*) AS c FROM encounters").get()).toEqual({
      c: 1,
    });
  });

  it("allows only one active encounter at the database level", () => {
    repo.getOrCreateActiveEncounter();
    expect(() =>
      db
        .prepare(
          "INSERT INTO encounters (id, active, created_at) VALUES ('x', 1, 0)",
        )
        .run(),
    ).toThrow();
  });
});

describe("addInstances", () => {
  it("persists many instances with currentHp = maxHp and returns them", () => {
    const added = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1", initiative: 14, groupId: "g1" }),
      goblin({ displayName: "Goblin 2", maxHp: 9 }),
    ]);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({
      displayName: "Goblin 1",
      maxHp: 7,
      currentHp: 7,
      initiative: 14,
      groupId: "g1",
    });
    expect(added[1]).toMatchObject({
      maxHp: 9,
      currentHp: 9,
      initiative: null,
      groupId: null,
    });
    expect(repo.listInstances()).toEqual(added);
  });

  it("rolls back the whole batch when a later item is invalid", () => {
    expect(() =>
      repo.addInstances(() => [goblin(), goblin(), goblin({ maxHp: 0 })]),
    ).toThrow();
    expect(repo.listInstances()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it("addInstances passes the current names to the builder and inserts the items it returns", () => {
    repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    const seen: string[][] = [];
    const added = repo.addInstances((names) => {
      seen.push([...names]);
      return [goblin({ displayName: "Goblin 3", maxHp: 9 })];
    });
    expect(seen).toEqual([["Goblin 1", "Goblin 2"]]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      displayName: "Goblin 3",
      maxHp: 9,
      currentHp: 9,
    });
    expect(repo.listInstances().map((i) => i.displayName)).toEqual([
      "Goblin 1",
      "Goblin 2",
      "Goblin 3",
    ]);
  });

  it("addInstances rolls back when the builder throws", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    let inTransaction: boolean | undefined;
    expect(() =>
      repo.addInstances(() => {
        inTransaction = db.isTransaction;
        // A write made while building must be undone with the batch.
        repo.applyDamage(m!.id, 3);
        throw new Error("builder failed");
      }),
    ).toThrow("builder failed");
    expect(inTransaction).toBe(true);
    expect(db.isTransaction).toBe(false);
    expect(repo.listInstances()).toEqual([m]);
  });
});

describe("applyDamage / applyHealing", () => {
  it("reduces HP and clamps at 0", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    expect(repo.applyDamage(m!.id, 3).after.currentHp).toBe(4);
    expect(repo.applyDamage(m!.id, 100).after.currentHp).toBe(0);
    expect(repo.listInstances()[0]!.currentHp).toBe(0);
  });

  it("raises HP and clamps at maxHp", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    repo.applyDamage(m!.id, 5);
    expect(repo.applyHealing(m!.id, 2).after.currentHp).toBe(4);
    expect(repo.applyHealing(m!.id, 100).after.currentHp).toBe(7);
  });

  it("applyDamage returns before and after", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    const hit = repo.applyDamage(m!.id, 3);
    expect(hit.before).toEqual(m);
    expect(hit.after).toEqual({ ...m, currentHp: 4 });
    const overkill = repo.applyDamage(m!.id, 100);
    expect(overkill.before.currentHp).toBe(4);
    expect(overkill.after.currentHp).toBe(0);
  });

  it("applyHealing returns before and after", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    repo.applyDamage(m!.id, 5);
    const healed = repo.applyHealing(m!.id, 2);
    expect(healed.before).toEqual({ ...m, currentHp: 2 });
    expect(healed.after).toEqual({ ...m, currentHp: 4 });
    const overheal = repo.applyHealing(m!.id, 100);
    expect(overheal.before.currentHp).toBe(4);
    expect(overheal.after.currentHp).toBe(7);
  });

  it("repository throws InvalidAmountError for a bad amount and UnknownInstanceError for an unknown id", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    expect(() => repo.applyDamage("nope", 1)).toThrow(UnknownInstanceError);
    expect(() => repo.applyHealing("nope", 1)).toThrow(UnknownInstanceError);
    expect(() => repo.applyDamage("nope", 1)).toThrow(
      "Unknown monster instance: nope",
    );
    expect(() => repo.applyDamage(m!.id, -1)).toThrow(InvalidAmountError);
    expect(() => repo.applyDamage(m!.id, 1.5)).toThrow(InvalidAmountError);
    expect(() => repo.applyHealing(m!.id, Number.NaN)).toThrow(
      InvalidAmountError,
    );
    expect(repo.listInstances()[0]!.currentHp).toBe(7);
  });
});

describe("removeInstances", () => {
  it("removeInstances removes all given ids and returns them", () => {
    const [a, b, c] = repo.addInstances(() => [
      goblin({ displayName: "A" }),
      goblin({ displayName: "B" }),
      goblin({ displayName: "C" }),
    ]);
    expect(repo.removeInstances([a!.id, c!.id])).toEqual([a, c]);
    expect(repo.listInstances()).toEqual([b]);
  });

  it("removeInstances with any unknown id removes nothing and throws UnknownInstanceError", () => {
    const added = repo.addInstances(() => [goblin(), goblin()]);
    const [a, b] = added;
    expect(() => repo.removeInstances([a!.id, "nope", b!.id])).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("active-encounter scoping", () => {
  it("ignores instances of an inactive encounter", () => {
    const [old] = repo.addInstances(() => [goblin()]);
    db.exec("UPDATE encounters SET active = 0");
    repo.addInstances(() => [goblin({ displayName: "New" })]);
    expect(() => repo.applyDamage(old!.id, 1)).toThrow(/Unknown/);
    expect(() => repo.applyHealing(old!.id, 1)).toThrow(/Unknown/);
    expect(() => repo.removeInstances([old!.id])).toThrow(UnknownInstanceError);
    expect(
      db
        .prepare("SELECT current_hp FROM monster_instances WHERE id = ?")
        .get(old!.id),
    ).toEqual({ current_hp: 7 });
    expect(repo.listInstances().map((i) => i.displayName)).toEqual(["New"]);
  });
});

describe("initiative validation", () => {
  it.each([1.5, Number.NaN, "3", Infinity])(
    "rejects %j and persists nothing",
    (bad) => {
      expect(() =>
        repo.addInstances(() => [
          goblin(),
          goblin({ initiative: bad as unknown as number }),
        ]),
      ).toThrow(RangeError);
      expect(repo.listInstances()).toEqual([]);
    },
  );

  it("accepts integers, null and undefined", () => {
    const added = repo.addInstances(() => [
      goblin({ initiative: -2 }),
      goblin({ initiative: 0 }),
      goblin({ initiative: null }),
      goblin(),
    ]);
    expect(added.map((i) => i.initiative)).toEqual([-2, 0, null, null]);
  });
});

describe("clearEncounter", () => {
  it("removes all instances", () => {
    repo.addInstances(() => [goblin(), goblin()]);
    repo.clearEncounter();
    expect(repo.listInstances()).toEqual([]);
  });
});

describe("listInstances", () => {
  it("is empty initially and ordered by creation", () => {
    expect(repo.listInstances()).toEqual([]);
    const added = repo.addInstances(() => [
      goblin({ displayName: "A" }),
      goblin({ displayName: "B" }),
      goblin({ displayName: "C" }),
    ]);
    repo.addInstances(() => [goblin({ displayName: "D" })]);
    expect(repo.listInstances().map((i) => i.displayName)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(repo.listInstances().slice(0, 3)).toEqual(added);
  });

  it("preserves insertion order when created_at ties (rowid tie-break)", () => {
    let n = 0;
    const tied = new SqliteEncounterRepository(openDatabase(":memory:"), {
      newId: () => `z${9 - ++n}`, // ids sort opposite to insertion order
      now: () => 1000,
    });
    tied.addInstances(() =>
      ["A", "B", "C", "D"].map((displayName) => goblin({ displayName })),
    );
    expect(tied.listInstances().map((i) => i.displayName)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});
