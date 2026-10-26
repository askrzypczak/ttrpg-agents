import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnknownInstanceError,
  UnknownMonsterError,
  mergeInitiative,
  rollInitiative,
  splitInitiative,
  type ChangeOrigin,
  type MergeInitiativeDeps,
  type MonsterInstance,
  type NewMonsterInstance,
  type Rng,
  type RollInitiativeDeps,
  type SplitInitiativeDeps,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };
const origin: ChangeOrigin = { source: "mcp", commandId: "regroup" };

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
let groupCount: number;

const newGroupId = (): string => `new-${String(++groupCount)}`;

function rollDeps(rng: Rng): RollInitiativeDeps {
  return { repo, monsters, rng, now: () => new Date(NOW) };
}

function splitDeps(rng: Rng = cycleRng(0)): SplitInitiativeDeps {
  return { ...rollDeps(rng), newGroupId };
}

function mergeDeps(): MergeInitiativeDeps {
  return { repo, newGroupId };
}

function seed(...items: NewMonsterInstance[]): void {
  repo.addInstances(() => items, seedOrigin);
}

function find(name: string): MonsterInstance {
  const found = repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

const idOf = (name: string): string => find(name).id;

/** [name, initiative, groupId] of every stored instance, in creation order. */
const state = (): [string, number | null, string | null][] =>
  repo.listInstances().map((i) => [i.displayName, i.initiative, i.groupId]);

beforeEach(() => {
  let n = 0;
  let t = 1000;
  groupCount = 0;
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
      monsterKey: SHADOW,
      displayName: "Shadow 3",
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
      monsterKey: GOBLIN,
      displayName: "Goblin Warrior 2",
      maxHp: 10,
      initiative: 12,
      groupId: "g3",
    },
    {
      monsterKey: OGRE,
      displayName: "Ogre 1",
      maxHp: 68,
      initiative: null,
      groupId: null,
    },
    {
      monsterKey: OGRE,
      displayName: "Ogre 2",
      maxHp: 68,
      initiative: null,
      groupId: null,
    },
  );
});

describe("splitInitiative", () => {
  it("splitInitiative gives each named instance a new group of its own and keeps its initiative, and an unnamed member keeps its group", () => {
    const s1 = idOf("Shadow 1");
    const s2 = idOf("Shadow 2");
    const setGroupId = vi.spyOn(repo, "setGroupId");
    const setInitiative = vi.spyOn(repo, "setInitiative");

    const result = splitInitiative(splitDeps(), [s1, s2], origin);

    expect(setGroupId.mock.calls).toEqual([
      [s1, "new-1", origin],
      [s2, "new-2", origin],
    ]);
    expect(setInitiative).not.toHaveBeenCalled();
    expect(result.rolls).toEqual([]);
    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]).toEqual({
      instance: find("Shadow 1"),
      before: 5,
    });
    expect(result.instances[1]).toEqual({
      instance: find("Shadow 2"),
      before: 5,
    });
    expect(state().slice(0, 3)).toEqual([
      ["Shadow 1", 5, "new-1"],
      ["Shadow 2", 5, "new-2"],
      ["Shadow 3", 5, "g1"],
    ]);
  });

  it("splitInitiative with roll rolls each named instance its own initiative and returns the values before, the d20 results, the modifiers and the roll log", () => {
    const s1 = idOf("Shadow 1");
    const s2 = idOf("Shadow 2");
    const mod = shadow.initiativeModifier;

    const result = splitInitiative(
      splitDeps(cycleRng(10, 2)),
      [s1, s2],
      origin,
      { roll: true },
    );

    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]).toEqual({
      instance: find("Shadow 1"),
      before: 5,
      rolled: { roll: 11, modifier: mod },
    });
    expect(result.instances[1]).toEqual({
      instance: find("Shadow 2"),
      before: 5,
      rolled: { roll: 3, modifier: mod },
    });
    expect(result.rolls).toHaveLength(2);
    expect(result.rolls[0]).toMatchObject({
      expression: "1d20",
      total: 11,
      label: "Shadow 1 initiative",
      timestamp: NOW,
    });
    expect(result.rolls[1]).toMatchObject({
      expression: "1d20",
      total: 3,
      label: "Shadow 2 initiative",
      timestamp: NOW,
    });
    expect(state().slice(0, 3)).toEqual([
      ["Shadow 1", 11 + mod, "new-1"],
      ["Shadow 2", 3 + mod, "new-2"],
      ["Shadow 3", 5, "g1"],
    ]);
  });

  it("a group-mode rollInitiative after a split rolls each split instance alone", () => {
    const ids = [idOf("Shadow 1"), idOf("Shadow 2")];
    const mod = shadow.initiativeModifier;
    splitInitiative(splitDeps(), ids, origin);

    const rolled = rollInitiative(rollDeps(cycleRng(10, 2)), ids, origin);

    expect(rolled.rolls.map((r) => r.total)).toEqual([11, 3]);
    expect(rolled.instances.map((i) => i.instance.initiative)).toEqual([
      11 + mod,
      3 + mod,
    ]);
  });
});

describe("mergeInitiative", () => {
  it("mergeInitiative puts the named instances into one new group, each taking the first named instance's initiative without a roll", () => {
    const gw1 = idOf("Goblin Warrior 1");
    const s1 = idOf("Shadow 1");
    const o1 = idOf("Ogre 1");
    const setGroupId = vi.spyOn(repo, "setGroupId");

    const result = mergeInitiative(mergeDeps(), [gw1, s1, o1], origin);

    expect(setGroupId.mock.calls).toEqual([
      [gw1, "new-1", origin],
      [s1, "new-1", origin],
      [o1, "new-1", origin],
    ]);
    expect(result.initiative).toBe(12);
    expect(result.instances).toEqual([
      { instance: find("Goblin Warrior 1"), before: 12 },
      { instance: find("Shadow 1"), before: 5 },
      { instance: find("Ogre 1"), before: null },
    ]);
    expect(state()).toEqual([
      ["Shadow 1", 12, "new-1"],
      ["Shadow 2", 5, "g1"],
      ["Shadow 3", 5, "g1"],
      ["Goblin Warrior 1", 12, "new-1"],
      ["Goblin Warrior 2", 12, "g3"],
      ["Ogre 1", 12, "new-1"],
      ["Ogre 2", null, null],
    ]);
  });

  it("mergeInitiative takes the initiative of the first named instance that has one, and leaves all unset when none has", () => {
    const o1 = idOf("Ogre 1");
    const s1 = idOf("Shadow 1");
    const gw1 = idOf("Goblin Warrior 1");

    const adopted = mergeInitiative(mergeDeps(), [o1, s1, gw1], origin);

    expect(adopted.initiative).toBe(5);
    expect(
      adopted.instances.map((i) => [i.instance.displayName, i.before]),
    ).toEqual([
      ["Ogre 1", null],
      ["Shadow 1", 5],
      ["Goblin Warrior 1", 12],
    ]);
    expect(
      [find("Ogre 1"), find("Shadow 1"), find("Goblin Warrior 1")].map((i) => [
        i.initiative,
        i.groupId,
      ]),
    ).toEqual([
      [5, "new-1"],
      [5, "new-1"],
      [5, "new-1"],
    ]);

    const o3Seed: NewMonsterInstance = {
      monsterKey: OGRE,
      displayName: "Ogre 3",
      maxHp: 68,
      initiative: null,
      groupId: null,
    };
    seed(o3Seed, { ...o3Seed, displayName: "Ogre 4" });
    const setInitiative = vi.spyOn(repo, "setInitiative");

    const none = mergeInitiative(
      mergeDeps(),
      [idOf("Ogre 3"), idOf("Ogre 4")],
      origin,
    );

    expect(none.initiative).toBeNull();
    expect(setInitiative).not.toHaveBeenCalled();
    expect(none.instances.map((i) => i.before)).toEqual([null, null]);
    expect(
      [find("Ogre 3"), find("Ogre 4")].map((i) => [i.initiative, i.groupId]),
    ).toEqual([
      [null, "new-2"],
      [null, "new-2"],
    ]);
  });

  it("mergeInitiative writes no initiative for a member already at the shared value", () => {
    const gw1 = idOf("Goblin Warrior 1");
    const gw2 = idOf("Goblin Warrior 2");
    const s1 = idOf("Shadow 1");
    const setInitiative = vi.spyOn(repo, "setInitiative");

    mergeInitiative(mergeDeps(), [gw1, gw2, s1], origin);

    expect(setInitiative.mock.calls).toEqual([[s1, 12, origin]]);
    expect(
      [
        find("Goblin Warrior 1"),
        find("Goblin Warrior 2"),
        find("Shadow 1"),
      ].map((i) => [i.initiative, i.groupId]),
    ).toEqual([
      [12, "new-1"],
      [12, "new-1"],
      [12, "new-1"],
    ]);
  });

  it("a group-mode rollInitiative after a merge gives the merged instances one shared roll", () => {
    const ids = [idOf("Shadow 1"), idOf("Goblin Warrior 1")];
    const mod = shadow.initiativeModifier;
    mergeInitiative(mergeDeps(), ids, origin);

    const rolled = rollInitiative(rollDeps(cycleRng(10, 2)), ids, origin);

    expect(rolled.rolls.map((r) => [r.label, r.total])).toEqual([
      ["Shadow initiative (group)", 11],
    ]);
    expect(rolled.instances.map((i) => i.instance.initiative)).toEqual([
      11 + mod,
      11 + mod,
    ]);
  });
});

describe("regrouping failures", () => {
  it("splitInitiative and mergeInitiative throw UnknownInstanceError for an id not in the encounter and change no group or initiative", () => {
    const before = repo.listInstances();
    const setGroupId = vi.spyOn(repo, "setGroupId");
    const setInitiative = vi.spyOn(repo, "setInitiative");
    const ids = [idOf("Shadow 1"), "no-such-id"];

    expect(() => splitInitiative(splitDeps(), ids, origin)).toThrow(
      UnknownInstanceError,
    );
    expect(() =>
      splitInitiative(splitDeps(cycleRng(10)), ids, origin, { roll: true }),
    ).toThrow(UnknownInstanceError);
    expect(() =>
      mergeInitiative(mergeDeps(), [idOf("Goblin Warrior 1"), ...ids], origin),
    ).toThrow(UnknownInstanceError);
    expect(setGroupId).not.toHaveBeenCalled();
    expect(setInitiative).not.toHaveBeenCalled();
    expect(repo.listInstances()).toEqual(before);
  });

  it("splitInitiative with roll throws UnknownMonsterError for an instance whose monster is not in the index and changes no group or initiative", () => {
    seed({
      monsterKey: "homebrew_not-in-the-srd",
      displayName: "Mystery 1",
      maxHp: 10,
      initiative: 9,
      groupId: "g9",
    });
    const before = repo.listInstances();
    const setGroupId = vi.spyOn(repo, "setGroupId");
    const setInitiative = vi.spyOn(repo, "setInitiative");

    expect(() =>
      splitInitiative(
        splitDeps(cycleRng(10)),
        [idOf("Shadow 1"), idOf("Mystery 1")],
        origin,
        { roll: true },
      ),
    ).toThrow(UnknownMonsterError);
    expect(setGroupId).not.toHaveBeenCalled();
    expect(setInitiative).not.toHaveBeenCalled();
    expect(repo.listInstances()).toEqual(before);
  });
});
