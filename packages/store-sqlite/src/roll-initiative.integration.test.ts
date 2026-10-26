import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnknownInstanceError,
  UnknownMonsterError,
  rollInitiative,
  type ChangeOrigin,
  type NewMonsterInstance,
  type Rng,
  type RollInitiativeDeps,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };
const origin: ChangeOrigin = { source: "mcp", commandId: "roll" };

const SHADOW = "srd-2024_shadow";
const GOBLIN = "srd-2024_goblin-warrior";
const OGRE = "srd-2024_ogre";
const monsters = loadSrdMonsters();
const shadow = monsters.byKey.get(SHADOW);
const goblin = monsters.byKey.get(GOBLIN);
const ogre = monsters.byKey.get(OGRE);
if (!shadow || !goblin || !ogre) throw new Error("SRD fixtures missing");

const NOW = "2026-01-01T00:00:00.000Z";

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max. */
function cycleRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

let repo: SqliteEncounterRepository;

function deps(rng: Rng): RollInitiativeDeps {
  return { repo, monsters, rng, now: () => new Date(NOW) };
}

function seed(...items: NewMonsterInstance[]): void {
  repo.addInstances(() => items, seedOrigin);
}

function idOf(name: string): string {
  const found = repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found.id;
}

const initiatives = (): [string, number | null][] =>
  repo.listInstances().map((i) => [i.displayName, i.initiative]);

beforeEach(() => {
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(openDatabase(":memory:"), {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  seed(
    {
      monsterKey: SHADOW,
      displayName: "Shadow 1",
      maxHp: 16,
      initiative: 5,
      groupId: "g1",
    },
    {
      monsterKey: SHADOW,
      displayName: "Shadow 2",
      maxHp: 16,
      initiative: 5,
      groupId: "g1",
    },
    {
      monsterKey: GOBLIN,
      displayName: "Goblin Warrior 1",
      maxHp: 10,
      initiative: 12,
      groupId: "g2",
    },
    {
      monsterKey: OGRE,
      displayName: "Ogre 1",
      maxHp: 68,
      initiative: null,
      groupId: null,
    },
  );
});

describe("rollInitiative", () => {
  it("rollInitiative writes each new value through setInitiative and returns the updated instances, their values before, the d20 results, the modifiers and the roll log", () => {
    const goblinId = idOf("Goblin Warrior 1");
    const shadowId = idOf("Shadow 1");
    const setInitiative = vi.spyOn(repo, "setInitiative");

    const result = rollInitiative(
      deps(cycleRng(14, 3)),
      [goblinId, shadowId],
      origin,
    );

    const goblinRoll = 15;
    const shadowRoll = 4;
    const goblinAfter = goblinRoll + goblin.initiativeModifier;
    const shadowAfter = shadowRoll + shadow.initiativeModifier;
    expect(setInitiative.mock.calls).toEqual([
      [goblinId, goblinAfter, origin],
      [shadowId, shadowAfter, origin],
    ]);
    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]).toMatchObject({
      instance: { id: goblinId, initiative: goblinAfter },
      before: 12,
      roll: goblinRoll,
      modifier: goblin.initiativeModifier,
    });
    expect(result.instances[1]).toMatchObject({
      instance: { id: shadowId, initiative: shadowAfter },
      before: 5,
      roll: shadowRoll,
      modifier: shadow.initiativeModifier,
    });
    expect(result.rolls).toHaveLength(2);
    expect(result.rolls[0]).toMatchObject({
      expression: "1d20",
      total: goblinRoll,
      label: "Goblin Warrior initiative (group)",
      timestamp: NOW,
    });
    expect(result.rolls[1]).toMatchObject({
      expression: "1d20",
      total: shadowRoll,
      label: "Shadow initiative (group)",
      timestamp: NOW,
    });
    expect(initiatives()).toEqual([
      ["Shadow 1", shadowAfter],
      ["Shadow 2", 5],
      ["Goblin Warrior 1", goblinAfter],
      ["Ogre 1", null],
    ]);
  });

  it("rollInitiative rolls a monster with no initiative and reports null as its value before", () => {
    const ogreId = idOf("Ogre 1");

    const result = rollInitiative(deps(cycleRng(7)), [ogreId], origin);

    const after = 8 + ogre.initiativeModifier;
    expect(result.instances).toEqual([
      expect.objectContaining({
        instance: expect.objectContaining({ id: ogreId, initiative: after }),
        before: null,
        roll: 8,
        modifier: ogre.initiativeModifier,
      }),
    ]);
    expect(result.rolls.map((r) => [r.label, r.total])).toEqual([
      ["Ogre 1 initiative", 8],
    ]);
    expect(initiatives()).toContainEqual(["Ogre 1", after]);
  });

  it("rollInitiative shares one roll among the members of a stored group by default and rolls each member in each mode", () => {
    const ids = [idOf("Shadow 1"), idOf("Shadow 2")];
    const mod = shadow.initiativeModifier;

    const grouped = rollInitiative(deps(cycleRng(10, 2)), ids, origin);
    expect(grouped.rolls.map((r) => [r.label, r.total])).toEqual([
      ["Shadow initiative (group)", 11],
    ]);
    expect(
      grouped.instances.map((i) => [i.roll, i.instance.initiative]),
    ).toEqual([
      [11, 11 + mod],
      [11, 11 + mod],
    ]);
    expect(initiatives().slice(0, 2)).toEqual([
      ["Shadow 1", 11 + mod],
      ["Shadow 2", 11 + mod],
    ]);

    const each = rollInitiative(deps(cycleRng(10, 2)), ids, origin, "each");
    expect(each.rolls.map((r) => [r.label, r.total])).toEqual([
      ["Shadow 1 initiative", 11],
      ["Shadow 2 initiative", 3],
    ]);
    expect(each.instances.map((i) => [i.roll, i.instance.initiative])).toEqual([
      [11, 11 + mod],
      [3, 3 + mod],
    ]);
    expect(initiatives().slice(0, 2)).toEqual([
      ["Shadow 1", 11 + mod],
      ["Shadow 2", 3 + mod],
    ]);
  });

  it("rollInitiative throws UnknownInstanceError for an id not in the encounter and changes no initiative", () => {
    const before = initiatives();
    const setInitiative = vi.spyOn(repo, "setInitiative");

    expect(() =>
      rollInitiative(
        deps(cycleRng(10)),
        [idOf("Shadow 1"), "no-such-id"],
        origin,
      ),
    ).toThrow(UnknownInstanceError);
    expect(setInitiative).not.toHaveBeenCalled();
    expect(initiatives()).toEqual(before);
  });

  it("rollInitiative throws UnknownMonsterError for an instance whose monster is not in the index and changes no initiative", () => {
    seed({
      monsterKey: "homebrew_not-in-the-srd",
      displayName: "Mystery 1",
      maxHp: 10,
      initiative: 9,
    });
    const before = initiatives();
    const setInitiative = vi.spyOn(repo, "setInitiative");

    expect(() =>
      rollInitiative(
        deps(cycleRng(10)),
        [idOf("Shadow 1"), idOf("Mystery 1")],
        origin,
        "each",
      ),
    ).toThrow(UnknownMonsterError);
    expect(setInitiative).not.toHaveBeenCalled();
    expect(initiatives()).toEqual(before);
  });
});
