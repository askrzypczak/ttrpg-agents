import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.js";
import {
  InvalidAmountError,
  InvalidArmorClassError,
  InvalidInitiativeError,
  InvalidNameError,
  UnknownInstanceError,
} from "@ttrpg-agents/engine";
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

describe("renameInstance", () => {
  it("renames and persists the display name", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    const renamed = repo.renameInstance(a!.id, "  Boss  ");
    expect(renamed).toEqual({ ...a, displayName: "Boss" });
    expect(repo.listInstances()).toEqual([renamed, b]);
    // Renaming to its own current name is allowed.
    expect(repo.renameInstance(a!.id, "Boss")).toEqual(renamed);
  });

  it("unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()]);
    expect(() => repo.renameInstance("nope", "Boss")).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("duplicate or empty name rejected, changes nothing", () => {
    const added = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    const id = added[0]!.id;
    for (const name of ["Goblin 2", " Goblin 2 ", "", "   "]) {
      expect(() => repo.renameInstance(id, name), name).toThrow(
        InvalidNameError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("does not rename an instance outside the active encounter", () => {
    const [old] = repo.addInstances(() => [goblin({ displayName: "Old" })]);
    db.exec("UPDATE encounters SET active = 0");
    repo.addInstances(() => [goblin({ displayName: "New" })]);
    expect(() => repo.renameInstance(old!.id, "Boss")).toThrow(
      UnknownInstanceError,
    );
    expect(
      db
        .prepare("SELECT display_name FROM monster_instances WHERE id = ?")
        .get(old!.id),
    ).toEqual({ display_name: "Old" });
    expect(repo.listInstances().map((i) => i.displayName)).toEqual(["New"]);
  });
});

describe("setInitiative", () => {
  it("setInitiative stores an integer, including zero and negative values, and returns the updated instance", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1", initiative: 12 }),
      goblin({ displayName: "Goblin 2", initiative: 9 }),
    ]);
    for (const value of [17, 0, -3]) {
      const updated = repo.setInitiative(a!.id, value);
      expect(updated, String(value)).toEqual({ ...a, initiative: value });
      expect(repo.listInstances(), String(value)).toEqual([updated, b]);
    }
    expect(db.isTransaction).toBe(false);
  });

  it("setInitiative on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ initiative: 12 })]);
    expect(() => repo.setInitiative("nope", 5)).toThrow(UnknownInstanceError);
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setInitiative rejects fractional, NaN and infinite values with InvalidInitiativeError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ initiative: 12 })]);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setInitiative(id, bad), String(bad)).toThrow(
        InvalidInitiativeError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.initiative).toBe(12);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setHp", () => {
  it("setHp stores an absolute value and returns before and after", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    const change = repo.setHp(a!.id, 3);
    expect(change.before).toEqual(a);
    expect(change.after).toEqual({ ...a, currentHp: 3 });
    expect(repo.listInstances()).toEqual([change.after, b]);
    const raised = repo.setHp(a!.id, 6);
    expect(raised.before.currentHp).toBe(3);
    expect(raised.after).toEqual({ ...a, currentHp: 6 });
    expect(repo.listInstances()).toEqual([raised.after, b]);
    expect(db.isTransaction).toBe(false);
  });

  it("setHp clamps to 0 and to max HP in the store", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    const low = repo.setHp(m!.id, -4);
    expect(low.after.currentHp).toBe(0);
    expect(repo.listInstances()[0]!.currentHp).toBe(0);
    const high = repo.setHp(m!.id, 50);
    expect(high.before.currentHp).toBe(0);
    expect(high.after.currentHp).toBe(7);
    expect(repo.listInstances()[0]!.currentHp).toBe(7);
  });

  it("setHp on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()]);
    expect(() => repo.setHp("nope", 3)).toThrow(UnknownInstanceError);
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setHp with a non-integer throws InvalidAmountError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()]);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setHp(id, bad), String(bad)).toThrow(
        InvalidAmountError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setMaxHp", () => {
  it("setMaxHp stores the value, keeps current HP when it fits and returns before and after", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    const raised = repo.setMaxHp(a!.id, 12);
    expect(raised.before).toEqual(a);
    expect(raised.after).toEqual({ ...a, maxHp: 12, currentHp: 7 });
    expect(repo.listInstances()).toEqual([raised.after, b]);
    repo.setHp(a!.id, 4);
    const lowered = repo.setMaxHp(a!.id, 5);
    expect(lowered.before).toEqual({ ...a, maxHp: 12, currentHp: 4 });
    expect(lowered.after).toEqual({ ...a, maxHp: 5, currentHp: 4 });
    expect(repo.listInstances()).toEqual([lowered.after, b]);
    expect(db.isTransaction).toBe(false);
  });

  it("setMaxHp lowers current HP in the store when the new max is below it", () => {
    const [m] = repo.addInstances(() => [goblin()]);
    const change = repo.setMaxHp(m!.id, 3);
    expect(change.before).toEqual(m);
    expect(change.after).toEqual({ ...m, maxHp: 3, currentHp: 3 });
    expect(repo.listInstances()).toEqual([change.after]);
    const floored = repo.setMaxHp(m!.id, 0);
    expect(floored.after).toEqual({ ...m, maxHp: 1, currentHp: 1 });
    expect(repo.listInstances()).toEqual([floored.after]);
  });

  it("setMaxHp with a non-integer throws InvalidAmountError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()]);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setMaxHp(id, bad), String(bad)).toThrow(
        InvalidAmountError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setMaxHp on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()]);
    expect(() => repo.setMaxHp("nope", 12)).toThrow(UnknownInstanceError);
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setArmorClass", () => {
  it("setArmorClass stores an integer and returns the updated instance", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1", armorClass: 15 }),
      goblin({ displayName: "Goblin 2", armorClass: 15 }),
    ]);
    for (const value of [17, 0, 12]) {
      const updated = repo.setArmorClass(a!.id, value);
      expect(updated, String(value)).toEqual({ ...a, armorClass: value });
      expect(repo.listInstances(), String(value)).toEqual([updated, b]);
    }
    expect(db.isTransaction).toBe(false);
  });

  it("setArmorClass clamps a negative value to 0 in the store", () => {
    const [m] = repo.addInstances(() => [goblin({ armorClass: 15 })]);
    const updated = repo.setArmorClass(m!.id, -3);
    expect(updated).toEqual({ ...m, armorClass: 0 });
    expect(repo.listInstances()).toEqual([updated]);
  });

  it("setArmorClass with a non-integer throws InvalidArmorClassError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ armorClass: 15 })]);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setArmorClass(id, bad), String(bad)).toThrow(
        InvalidArmorClassError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.armorClass).toBe(15);
    expect(db.isTransaction).toBe(false);
  });

  it("setArmorClass on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ armorClass: 15 })]);
    expect(() => repo.setArmorClass("nope", 12)).toThrow(UnknownInstanceError);
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.armorClass).toBe(15);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setStatsVisible", () => {
  it("setStatsVisible persists true and back to false and returns the updated instance", () => {
    const [a, b] = repo.addInstances(() => [
      goblin({ displayName: "Goblin 1" }),
      goblin({ displayName: "Goblin 2" }),
    ]);
    expect(a!.statsVisible).toBe(false);

    const revealed = repo.setStatsVisible(a!.id, true);
    expect(revealed).toEqual({ ...a, statsVisible: true });
    expect(repo.listInstances()).toEqual([revealed, b]);

    const hidden = repo.setStatsVisible(a!.id, false);
    expect(hidden).toEqual({ ...a, statsVisible: false });
    expect(repo.listInstances()).toEqual([hidden, b]);
    expect(db.isTransaction).toBe(false);
  });

  it("setStatsVisible throws UnknownInstanceError for an id not in the active encounter", () => {
    const [old] = repo.addInstances(() => [goblin()]);
    db.exec("UPDATE encounters SET active = 0");
    const current = repo.addInstances(() => [goblin({ displayName: "New" })]);

    for (const id of ["nope", old!.id]) {
      expect(() => repo.setStatsVisible(id, true), id).toThrow(
        UnknownInstanceError,
      );
    }
    expect(repo.listInstances()).toEqual(current);
    expect(
      db
        .prepare("SELECT stats_visible FROM monster_instances WHERE id = ?")
        .get(old!.id),
    ).toEqual({ stats_visible: 0 });
    expect(db.isTransaction).toBe(false);
  });
});

describe("armor class on insert", () => {
  it("addInstances stores the given armorClass and null when none is given", () => {
    const added = repo.addInstances(() => [
      goblin({ displayName: "A", armorClass: 15 }),
      goblin({ displayName: "B", armorClass: 0 }),
      goblin({ displayName: "C", armorClass: null }),
      goblin({ displayName: "D" }),
    ]);
    expect(added.map((i) => i.armorClass)).toEqual([15, 0, null, null]);
    expect(repo.listInstances()).toEqual(added);
  });

  it("addInstances rejects a negative or non-integer armorClass with RangeError and stores nothing", () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, "13"]) {
      expect(
        () =>
          repo.addInstances(() => [
            goblin({ armorClass: 15 }),
            goblin({ armorClass: bad as unknown as number }),
          ]),
        String(bad),
      ).toThrow(RangeError);
    }
    expect(repo.listInstances()).toEqual([]);
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
