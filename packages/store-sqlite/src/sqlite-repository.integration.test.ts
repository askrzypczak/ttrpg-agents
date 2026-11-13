import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.js";
import { SqliteEncounterDirectory } from "./sqlite-directory.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import {
  InvalidAmountError,
  InvalidArmorClassError,
  InvalidInitiativeError,
  InvalidNameError,
  UnknownInstanceError,
  type ChangeOrigin,
  resolveEncounter,
} from "@ttrpg-agents/engine";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

let db: DatabaseSync;
let repo: SqliteEncounterRepository;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  const options = {
    newId: () => `id-${++n}`,
    now: () => ++t,
  };
  repo = new SqliteEncounterRepository(
    db,
    resolveEncounter(new SqliteEncounterDirectory(db, options)).id,
    options,
  );
});

const goblin = (over = {}) => ({
  monsterKey: "goblin",
  displayName: "Goblin",
  maxHp: 7,
  ...over,
});

describe("addInstances", () => {
  it("persists many instances with currentHp = maxHp and returns them", () => {
    const added = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1", initiative: 14, groupId: "g1" }),
        goblin({ displayName: "Goblin 2", maxHp: 9 }),
      ],
      origin,
    );
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

  it("addInstances stores a spawn position and reads it back", () => {
    const added = repo.addInstances(
      () => [
        goblin({
          displayName: "Goblin 1",
          spawnPosition: { x: 225, y: 375 },
        }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    expect(added.map((i) => i.spawnPosition)).toEqual([
      { x: 225, y: 375 },
      null,
    ]);
    expect(repo.listInstances().map((i) => i.spawnPosition)).toEqual([
      { x: 225, y: 375 },
      null,
    ]);
  });

  it("rolls back the whole batch when a later item is invalid", () => {
    expect(() =>
      repo.addInstances(
        () => [goblin(), goblin(), goblin({ maxHp: 0 })],
        origin,
      ),
    ).toThrow();
    expect(repo.listInstances()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it("addInstances passes the current names to the builder and inserts the items it returns", () => {
    repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    const seen: string[][] = [];
    const added = repo.addInstances((names) => {
      seen.push([...names]);
      return [goblin({ displayName: "Goblin 3", maxHp: 9 })];
    }, origin);
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
    const [m] = repo.addInstances(() => [goblin()], origin);
    let inTransaction: boolean | undefined;
    expect(() =>
      repo.addInstances(() => {
        inTransaction = db.isTransaction;
        // A write made while building must be undone with the batch.
        repo.applyDamage(m!.id, 3, origin);
        throw new Error("builder failed");
      }, origin),
    ).toThrow("builder failed");
    expect(inTransaction).toBe(true);
    expect(db.isTransaction).toBe(false);
    expect(repo.listInstances()).toEqual([m]);
  });
});

describe("applyDamage / applyHealing", () => {
  it("reduces HP and clamps at 0", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    expect(repo.applyDamage(m!.id, 3, origin).after.currentHp).toBe(4);
    expect(repo.applyDamage(m!.id, 100, origin).after.currentHp).toBe(0);
    expect(repo.listInstances()[0]!.currentHp).toBe(0);
  });

  it("raises HP and clamps at maxHp", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    repo.applyDamage(m!.id, 5, origin);
    expect(repo.applyHealing(m!.id, 2, origin).after.currentHp).toBe(4);
    expect(repo.applyHealing(m!.id, 100, origin).after.currentHp).toBe(7);
  });

  it("applyDamage returns before and after", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    const hit = repo.applyDamage(m!.id, 3, origin);
    expect(hit.before).toEqual(m);
    expect(hit.after).toEqual({ ...m, currentHp: 4 });
    const overkill = repo.applyDamage(m!.id, 100, origin);
    expect(overkill.before.currentHp).toBe(4);
    expect(overkill.after.currentHp).toBe(0);
  });

  it("applyHealing returns before and after", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    repo.applyDamage(m!.id, 5, origin);
    const healed = repo.applyHealing(m!.id, 2, origin);
    expect(healed.before).toEqual({ ...m, currentHp: 2 });
    expect(healed.after).toEqual({ ...m, currentHp: 4 });
    const overheal = repo.applyHealing(m!.id, 100, origin);
    expect(overheal.before.currentHp).toBe(4);
    expect(overheal.after.currentHp).toBe(7);
  });

  it("repository throws InvalidAmountError for a bad amount and UnknownInstanceError for an unknown id", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    expect(() => repo.applyDamage("nope", 1, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(() => repo.applyHealing("nope", 1, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(() => repo.applyDamage("nope", 1, origin)).toThrow(
      "Unknown monster instance: nope",
    );
    expect(() => repo.applyDamage(m!.id, -1, origin)).toThrow(
      InvalidAmountError,
    );
    expect(() => repo.applyDamage(m!.id, 1.5, origin)).toThrow(
      InvalidAmountError,
    );
    expect(() => repo.applyHealing(m!.id, Number.NaN, origin)).toThrow(
      InvalidAmountError,
    );
    expect(repo.listInstances()[0]!.currentHp).toBe(7);
  });
});

describe("removeInstances", () => {
  it("removeInstances removes all given ids and returns them", () => {
    const [a, b, c] = repo.addInstances(
      () => [
        goblin({ displayName: "A" }),
        goblin({ displayName: "B" }),
        goblin({ displayName: "C" }),
      ],
      origin,
    );
    expect(repo.removeInstances([a!.id, c!.id], origin)).toEqual([a, c]);
    expect(repo.listInstances()).toEqual([b]);
  });

  it("removeInstances with any unknown id removes nothing and throws UnknownInstanceError", () => {
    const added = repo.addInstances(() => [goblin(), goblin()], origin);
    const [a, b] = added;
    expect(() => repo.removeInstances([a!.id, "nope", b!.id], origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("renameInstance", () => {
  it("renames and persists the display name", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    const renamed = repo.renameInstance(a!.id, "  Boss  ", origin);
    expect(renamed).toEqual({ ...a, displayName: "Boss" });
    expect(repo.listInstances()).toEqual([renamed, b]);
    // Renaming to its own current name is allowed.
    expect(repo.renameInstance(a!.id, "Boss", origin)).toEqual(renamed);
  });

  it("unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()], origin);
    expect(() => repo.renameInstance("nope", "Boss", origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("duplicate or empty name rejected, changes nothing", () => {
    const added = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    const id = added[0]!.id;
    for (const name of ["Goblin 2", " Goblin 2 ", "", "   "]) {
      expect(() => repo.renameInstance(id, name, origin), name).toThrow(
        InvalidNameError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setInitiative", () => {
  it("setInitiative stores an integer, including zero and negative values, and returns the updated instance", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1", initiative: 12 }),
        goblin({ displayName: "Goblin 2", initiative: 9 }),
      ],
      origin,
    );
    for (const value of [17, 0, -3]) {
      const updated = repo.setInitiative(a!.id, value, origin);
      expect(updated, String(value)).toEqual({ ...a, initiative: value });
      expect(repo.listInstances(), String(value)).toEqual([updated, b]);
    }
    expect(db.isTransaction).toBe(false);
  });

  it("setInitiative null clears the initiative and records instance-changed with initiative null", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1", initiative: 12 }),
        goblin({ displayName: "Goblin 2", initiative: 9 }),
      ],
      origin,
    );

    const updated = repo.setInitiative(a!.id, null, origin);

    expect(updated).toEqual({ ...a, initiative: null });
    expect(repo.listInstances()).toEqual([updated, b]);
    const rows = db
      .prepare("SELECT event FROM encounter_events ORDER BY seq DESC LIMIT 1")
      .all() as { event: string }[];
    expect(JSON.parse(rows[0]!.event)).toEqual({
      type: "instance-changed",
      id: a!.id,
      changes: { initiative: null },
      origin,
    });
    expect(db.isTransaction).toBe(false);
  });

  it("setInitiative on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ initiative: 12 })], origin);
    expect(() => repo.setInitiative("nope", 5, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setInitiative rejects fractional, NaN and infinite values with InvalidInitiativeError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ initiative: 12 })], origin);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setInitiative(id, bad, origin), String(bad)).toThrow(
        InvalidInitiativeError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.initiative).toBe(12);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setGroupId", () => {
  it("setGroupId stores the group, returns the updated instance and records instance-changed with groupId", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1", initiative: 12, groupId: "g-old" }),
        goblin({ displayName: "Goblin 2", initiative: 12, groupId: "g-old" }),
      ],
      origin,
    );

    const updated = repo.setGroupId(a!.id, "g-new", origin);

    expect(updated).toEqual({ ...a, groupId: "g-new" });
    expect(repo.listInstances()).toEqual([updated, b]);
    const rows = db
      .prepare("SELECT event FROM encounter_events ORDER BY seq DESC LIMIT 1")
      .all() as { event: string }[];
    expect(JSON.parse(rows[0]!.event)).toEqual({
      type: "instance-changed",
      id: a!.id,
      changes: { groupId: "g-new" },
      origin,
    });
    expect(db.isTransaction).toBe(false);
  });

  it("setGroupId on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(
      () => [goblin({ initiative: 12, groupId: "g-old" })],
      origin,
    );
    const eventCount = () =>
      db.prepare("SELECT COUNT(*) AS c FROM encounter_events").get();
    const eventsBefore = eventCount();

    expect(() => repo.setGroupId("nope", "g-new", origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(eventCount()).toEqual(eventsBefore);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setHp", () => {
  it("setHp stores an absolute value and returns before and after", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    const change = repo.setHp(a!.id, 3, origin);
    expect(change.before).toEqual(a);
    expect(change.after).toEqual({ ...a, currentHp: 3 });
    expect(repo.listInstances()).toEqual([change.after, b]);
    const raised = repo.setHp(a!.id, 6, origin);
    expect(raised.before.currentHp).toBe(3);
    expect(raised.after).toEqual({ ...a, currentHp: 6 });
    expect(repo.listInstances()).toEqual([raised.after, b]);
    expect(db.isTransaction).toBe(false);
  });

  it("setHp clamps to 0 and to max HP in the store", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    const low = repo.setHp(m!.id, -4, origin);
    expect(low.after.currentHp).toBe(0);
    expect(repo.listInstances()[0]!.currentHp).toBe(0);
    const high = repo.setHp(m!.id, 50, origin);
    expect(high.before.currentHp).toBe(0);
    expect(high.after.currentHp).toBe(7);
    expect(repo.listInstances()[0]!.currentHp).toBe(7);
  });

  it("setHp on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()], origin);
    expect(() => repo.setHp("nope", 3, origin)).toThrow(UnknownInstanceError);
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setHp with a non-integer throws InvalidAmountError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()], origin);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setHp(id, bad, origin), String(bad)).toThrow(
        InvalidAmountError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setMaxHp", () => {
  it("setMaxHp stores the value, keeps current HP when it fits and returns before and after", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    const raised = repo.setMaxHp(a!.id, 12, origin);
    expect(raised.before).toEqual(a);
    expect(raised.after).toEqual({ ...a, maxHp: 12, currentHp: 7 });
    expect(repo.listInstances()).toEqual([raised.after, b]);
    repo.setHp(a!.id, 4, origin);
    const lowered = repo.setMaxHp(a!.id, 5, origin);
    expect(lowered.before).toEqual({ ...a, maxHp: 12, currentHp: 4 });
    expect(lowered.after).toEqual({ ...a, maxHp: 5, currentHp: 4 });
    expect(repo.listInstances()).toEqual([lowered.after, b]);
    expect(db.isTransaction).toBe(false);
  });

  it("setMaxHp lowers current HP in the store when the new max is below it", () => {
    const [m] = repo.addInstances(() => [goblin()], origin);
    const change = repo.setMaxHp(m!.id, 3, origin);
    expect(change.before).toEqual(m);
    expect(change.after).toEqual({ ...m, maxHp: 3, currentHp: 3 });
    expect(repo.listInstances()).toEqual([change.after]);
    const floored = repo.setMaxHp(m!.id, 0, origin);
    expect(floored.after).toEqual({ ...m, maxHp: 1, currentHp: 1 });
    expect(repo.listInstances()).toEqual([floored.after]);
  });

  it("setMaxHp with a non-integer throws InvalidAmountError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()], origin);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setMaxHp(id, bad, origin), String(bad)).toThrow(
        InvalidAmountError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });

  it("setMaxHp on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin()], origin);
    expect(() => repo.setMaxHp("nope", 12, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setArmorClass", () => {
  it("setArmorClass stores an integer and returns the updated instance", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1", armorClass: 15 }),
        goblin({ displayName: "Goblin 2", armorClass: 15 }),
      ],
      origin,
    );
    for (const value of [17, 0, 12]) {
      const updated = repo.setArmorClass(a!.id, value, origin);
      expect(updated, String(value)).toEqual({ ...a, armorClass: value });
      expect(repo.listInstances(), String(value)).toEqual([updated, b]);
    }
    expect(db.isTransaction).toBe(false);
  });

  it("setArmorClass clamps a negative value to 0 in the store", () => {
    const [m] = repo.addInstances(() => [goblin({ armorClass: 15 })], origin);
    const updated = repo.setArmorClass(m!.id, -3, origin);
    expect(updated).toEqual({ ...m, armorClass: 0 });
    expect(repo.listInstances()).toEqual([updated]);
  });

  it("setArmorClass with a non-integer throws InvalidArmorClassError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ armorClass: 15 })], origin);
    const id = added[0]!.id;
    for (const bad of [1.5, -0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => repo.setArmorClass(id, bad, origin), String(bad)).toThrow(
        InvalidArmorClassError,
      );
    }
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.armorClass).toBe(15);
    expect(db.isTransaction).toBe(false);
  });

  it("setArmorClass on an unknown id throws UnknownInstanceError and changes nothing", () => {
    const added = repo.addInstances(() => [goblin({ armorClass: 15 })], origin);
    expect(() => repo.setArmorClass("nope", 12, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(repo.listInstances()).toEqual(added);
    expect(repo.listInstances()[0]!.armorClass).toBe(15);
    expect(db.isTransaction).toBe(false);
  });
});

describe("setStatsVisible", () => {
  it("setStatsVisible persists true and back to false and returns the updated instance", () => {
    const [a, b] = repo.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    expect(a!.statsVisible).toBe(false);

    const revealed = repo.setStatsVisible(a!.id, true, origin);
    expect(revealed).toEqual({ ...a, statsVisible: true });
    expect(repo.listInstances()).toEqual([revealed, b]);

    const hidden = repo.setStatsVisible(a!.id, false, origin);
    expect(hidden).toEqual({ ...a, statsVisible: false });
    expect(repo.listInstances()).toEqual([hidden, b]);
    expect(db.isTransaction).toBe(false);
  });
});

describe("armor class on insert", () => {
  it("addInstances stores the given armorClass and null when none is given", () => {
    const added = repo.addInstances(
      () => [
        goblin({ displayName: "A", armorClass: 15 }),
        goblin({ displayName: "B", armorClass: 0 }),
        goblin({ displayName: "C", armorClass: null }),
        goblin({ displayName: "D" }),
      ],
      origin,
    );
    expect(added.map((i) => i.armorClass)).toEqual([15, 0, null, null]);
    expect(repo.listInstances()).toEqual(added);
  });

  it("addInstances rejects a negative or non-integer armorClass with RangeError and stores nothing", () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, "13"]) {
      expect(
        () =>
          repo.addInstances(
            () => [
              goblin({ armorClass: 15 }),
              goblin({ armorClass: bad as unknown as number }),
            ],
            origin,
          ),
        String(bad),
      ).toThrow(RangeError);
    }
    expect(repo.listInstances()).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });
});

describe("initiative validation", () => {
  it.each([1.5, Number.NaN, "3", Infinity])(
    "rejects %j and persists nothing",
    (bad) => {
      expect(() =>
        repo.addInstances(
          () => [goblin(), goblin({ initiative: bad as unknown as number })],
          origin,
        ),
      ).toThrow(RangeError);
      expect(repo.listInstances()).toEqual([]);
    },
  );

  it("accepts integers, null and undefined", () => {
    const added = repo.addInstances(
      () => [
        goblin({ initiative: -2 }),
        goblin({ initiative: 0 }),
        goblin({ initiative: null }),
        goblin(),
      ],
      origin,
    );
    expect(added.map((i) => i.initiative)).toEqual([-2, 0, null, null]);
  });
});

describe("clearEncounter", () => {
  it("removes all instances", () => {
    repo.addInstances(() => [goblin(), goblin()], origin);
    repo.clearEncounter(origin);
    expect(repo.listInstances()).toEqual([]);
  });
});

describe("listInstances", () => {
  it("is empty initially and ordered by creation", () => {
    expect(repo.listInstances()).toEqual([]);
    const added = repo.addInstances(
      () => [
        goblin({ displayName: "A" }),
        goblin({ displayName: "B" }),
        goblin({ displayName: "C" }),
      ],
      origin,
    );
    repo.addInstances(() => [goblin({ displayName: "D" })], origin);
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
    const store = openDatabase(":memory:");
    const options = {
      newId: () => `z${9 - ++n}`, // ids sort opposite to insertion order
      now: () => 1000,
    };
    const tied = new SqliteEncounterRepository(
      store,
      resolveEncounter(new SqliteEncounterDirectory(store, options)).id,
      options,
    );
    tied.addInstances(
      () => ["A", "B", "C", "D"].map((displayName) => goblin({ displayName })),
      origin,
    );
    expect(tied.listInstances().map((i) => i.displayName)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});

describe("encounter scoping", () => {
  const scopeDirs: string[] = [];
  afterEach(() => {
    for (const d of scopeDirs.splice(0))
      rmSync(d, { recursive: true, force: true });
  });

  /** Two named encounters in one store, B current, with a repository scoped to each. */
  function twoEncounters() {
    const store = openDatabase(":memory:");
    let n = 0;
    let t = 1000;
    const options = { newId: () => `sc-${String(++n)}`, now: () => ++t };
    const directory = new SqliteEncounterDirectory(store, options);
    const a = directory.createEncounter("Encounter A");
    const b = directory.createEncounter("Encounter B");
    directory.setCurrentEncounter(b.id);
    return {
      store,
      directory,
      a,
      b,
      repoA: new SqliteEncounterRepository(store, a.id, options),
      repoB: new SqliteEncounterRepository(store, b.id, options),
    };
  }

  it("listInstances of a repository scoped to one encounter lists only that encounter's live instances", () => {
    const { a, repoA, repoB } = twoEncounters();
    const [kept, removed] = repoA.addInstances(
      () => [
        goblin({ displayName: "Goblin 1" }),
        goblin({ displayName: "Goblin 2" }),
      ],
      origin,
    );
    repoA.removeInstances([removed!.id], origin);
    const inB = repoB.addInstances(
      () => [goblin({ displayName: "Goblin 1" })],
      origin,
    );

    expect(repoA.listInstances()).toEqual([kept]);
    expect(kept!.encounterId).toBe(a.id);
    expect(repoB.listInstances()).toEqual(inB);
  });

  it("addInstances adds to its own encounter and passes only that encounter's names to the builder", () => {
    const { a, b, repoA, repoB } = twoEncounters();
    const inB = repoB.addInstances(
      () => [goblin({ displayName: "Goblin 1" })],
      origin,
    );
    repoA.addInstances(() => [goblin({ displayName: "Wolf 1" })], origin);

    let seen: string[] | undefined;
    const added = repoA.addInstances((names) => {
      seen = names;
      return [goblin({ displayName: "Wolf 2" })];
    }, origin);

    expect(seen).toEqual(["Wolf 1"]);
    expect(added.map((i) => i.encounterId)).toEqual([a.id]);
    expect(repoA.listInstances().map((i) => i.displayName)).toEqual([
      "Wolf 1",
      "Wolf 2",
    ]);
    expect(repoB.listInstances()).toEqual(inB);
    expect(inB.map((i) => i.encounterId)).toEqual([b.id]);
  });

  const mutations: [
    string,
    (repo: SqliteEncounterRepository, id: string) => unknown,
  ][] = [
    ["applyDamage", (r, id) => r.applyDamage(id, 3, origin)],
    ["applyHealing", (r, id) => r.applyHealing(id, 1, origin)],
    ["setHp", (r, id) => r.setHp(id, 2, origin)],
    ["setMaxHp", (r, id) => r.setMaxHp(id, 10, origin)],
    ["setArmorClass", (r, id) => r.setArmorClass(id, 15, origin)],
    ["setInitiative", (r, id) => r.setInitiative(id, 12, origin)],
    ["setGroupId", (r, id) => r.setGroupId(id, "g9", origin)],
    ["setStatsVisible", (r, id) => r.setStatsVisible(id, true, origin)],
    ["renameInstance", (r, id) => r.renameInstance(id, "Boss", origin)],
    ["removeInstances", (r, id) => r.removeInstances([id], origin)],
    [
      "setSpawnPositions",
      (r, id) =>
        r.setSpawnPositions([{ id, spawnPosition: { x: 1, y: 2 } }], origin),
    ],
    [
      "changeMonsters",
      (r, id) =>
        r.changeMonsters(
          [
            {
              id,
              monsterKey: "wolf",
              displayName: "Wolf 1",
              maxHp: 11,
              currentHp: 11,
              armorClass: 13,
              initiative: null,
              footprint: 1,
            },
          ],
          origin,
        ),
    ],
  ];

  it.each(mutations)(
    "every per-instance mutation of a scoped repository refuses an instance of another encounter with UnknownInstanceError and changes nothing (%s)",
    (_name, mutate) => {
      const { store, repoA, repoB } = twoEncounters();
      repoA.addInstances(() => [goblin({ displayName: "Goblin A" })], origin);
      const [other] = repoB.addInstances(
        () => [goblin({ displayName: "Goblin B", maxHp: 9 })],
        origin,
      );
      repoB.applyDamage(other!.id, 4, origin);
      const log = new SqliteEncounterLog(store);
      const before = {
        a: repoA.listInstances(),
        b: repoB.listInstances(),
        removedB: repoB.listRemovedInstances(),
        undoA: repoA.latestUndoRecord(),
        seq: log.latestSeq(),
      };

      expect(() => mutate(repoA, other!.id)).toThrow(UnknownInstanceError);

      expect({
        a: repoA.listInstances(),
        b: repoB.listInstances(),
        removedB: repoB.listRemovedInstances(),
        undoA: repoA.latestUndoRecord(),
        seq: log.latestSeq(),
      }).toEqual(before);
    },
  );

  it("a repository scoped to encounter A keeps reading and writing A after another connection makes B current", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-scope-"));
    scopeDirs.push(dir);
    const path = join(dir, "enc.db");
    const first = openDatabase(path);
    const second = openDatabase(path);
    try {
      const firstDirectory = new SqliteEncounterDirectory(first);
      const a = firstDirectory.createEncounter("Encounter A");
      firstDirectory.setCurrentEncounter(a.id);
      const repoA = new SqliteEncounterRepository(first, a.id);
      const [ogre1] = repoA.addInstances(
        () => [goblin({ displayName: "Ogre 1", maxHp: 59 })],
        origin,
      );

      const secondDirectory = new SqliteEncounterDirectory(second);
      const b = secondDirectory.createEncounter("Encounter B");
      secondDirectory.setCurrentEncounter(b.id);
      expect(firstDirectory.getCurrentEncounter()).toEqual(b);

      const seqBefore = new SqliteEncounterLog(first).latestSeq();
      const [ogre2] = repoA.addInstances(
        () => [goblin({ displayName: "Ogre 2", maxHp: 59 })],
        origin,
      );
      repoA.applyDamage(ogre1!.id, 5, origin);

      expect(ogre2!.encounterId).toBe(a.id);
      expect(
        repoA.listInstances().map((i) => [i.id, i.encounterId, i.currentHp]),
      ).toEqual([
        [ogre1!.id, a.id, 54],
        [ogre2!.id, a.id, 59],
      ]);
      expect(
        new SqliteEncounterRepository(second, b.id).listInstances(),
      ).toEqual([]);
      const events = new SqliteEncounterLog(second).eventsSince(seqBefore);
      expect(events.length).toBeGreaterThan(0);
      for (const entry of events)
        expect(entry).toMatchObject({ encounterId: a.id });
    } finally {
      second.close();
      first.close();
    }
  });
});
