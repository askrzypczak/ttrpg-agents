import { describe, expect, it } from "vitest";
import type { Rng } from "../dice/rng.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { makeTestInstance } from "../testing/index.js";
import type { HpMode } from "./add-monsters.js";
import {
  changeMonsterType,
  type ChangeMonsterTypeResult,
} from "./change-monster.js";
import {
  SameMonsterError,
  UnknownInstanceError,
  UnknownMonsterError,
} from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, MonsterChange } from "./repository.js";
import type { MonsterInstance } from "./types.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "c1" };
const NOW = "2026-01-01T00:00:00.000Z";

function monster(
  key: string,
  name: string,
  stats: {
    size: string;
    ac: number;
    hp: Monster["hp"];
    initiativeModifier: number;
  },
): Monster {
  return {
    key,
    name,
    source: "private",
    size: stats.size,
    type: "beast",
    alignment: "unaligned",
    ac: stats.ac,
    armorDetail: "",
    hp: stats.hp,
    speeds: { walk: 40 },
    abilities: { str: 12, dex: 14, con: 12, int: 3, wis: 12, cha: 6 },
    initiativeModifier: stats.initiativeModifier,
    cr: 0.25,
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    senses: {},
    languages: "",
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
  };
}

const bestiary = [
  monster("wolf", "Wolf", {
    size: "medium",
    ac: 13,
    hp: { average: 11, dice: "2d8+2" },
    initiativeModifier: 2,
  }),
  monster("dire-wolf", "Dire Wolf", {
    size: "large",
    ac: 14,
    hp: { average: 37, dice: "5d10+10" },
    initiativeModifier: 1,
  }),
  monster("goblin-boss", "Goblin Boss", {
    size: "small",
    ac: 17,
    hp: { average: 21, dice: "6d6" },
    initiativeModifier: 2,
  }),
  monster("owlbear", "Owlbear", {
    size: "large",
    ac: 13,
    hp: { average: 59, dice: "7d10+21" },
    initiativeModifier: 1,
  }),
];
const monsters: MonsterIndex = {
  monsters: bestiary,
  byKey: new Map(bestiary.map((m) => [m.key, m] as const)),
};

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max; counts calls. */
function cycleRng(...values: number[]): Rng & { calls: number } {
  let i = 0;
  const rng = {
    calls: 0,
    nextInt(max: number) {
      rng.calls++;
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
  return rng;
}

/**
 * An in-memory repository: lists the given instances and applies each
 * `changeMonsters` call as given (keeping the other fields), recording it.
 */
function memoryRepo(instances: MonsterInstance[]): EncounterRepository & {
  calls: { changes: MonsterChange[]; origin: ChangeOrigin }[];
} {
  const byId = new Map(instances.map((i) => [i.id, { ...i }]));
  const calls: { changes: MonsterChange[]; origin: ChangeOrigin }[] = [];
  const unexpected = () => {
    throw new Error("unexpected call");
  };
  return {
    calls,
    getOrCreateActiveEncounter: unexpected,
    addInstances: unexpected,
    applyDamage: unexpected,
    applyHealing: unexpected,
    removeInstances: unexpected,
    listRemovedInstances: unexpected,
    restoreInstances: unexpected,
    renameInstance: unexpected,
    setInitiative: unexpected,
    setGroupId: unexpected,
    setHp: unexpected,
    setMaxHp: unexpected,
    setArmorClass: unexpected,
    setStatsVisible: unexpected,
    setSpawnPositions: unexpected,
    clearEncounter: unexpected,
    changeMonsters: (changes, changeOrigin) => {
      calls.push({
        changes: structuredClone([...changes]),
        origin: changeOrigin,
      });
      return changes.map((change) => {
        const current = byId.get(change.id);
        if (!current)
          throw new UnknownInstanceError(`no instance ${change.id}`);
        const after = { ...current, ...change };
        byId.set(change.id, after);
        return { ...after };
      });
    },
    listInstances: () => [...byId.values()].map((i) => ({ ...i })),
    noteCommand: unexpected,
    transaction: (fn) => fn(),
    latestUndoRecord: unexpected,
    forgetCommands: unexpected,
  };
}

function run(
  instances: MonsterInstance[],
  ids: readonly string[],
  monsterKey: string,
  mode: HpMode = "average",
  rng: Rng & { calls: number } = cycleRng(0),
): {
  result: ChangeMonsterTypeResult;
  repo: ReturnType<typeof memoryRepo>;
  rng: Rng & { calls: number };
} {
  const repo = memoryRepo(instances);
  const result = changeMonsterType(
    { repo, monsters, rng, now: () => new Date(NOW) },
    ids,
    monsterKey,
    mode,
    origin,
  );
  return { result, repo, rng };
}

function wolf(
  id: string,
  displayName: string,
  overrides: Partial<MonsterInstance> = {},
): MonsterInstance {
  return makeTestInstance({
    id,
    monsterKey: "wolf",
    displayName,
    maxHp: 11,
    currentHp: 11,
    armorClass: 13,
    initiative: 15,
    footprint: 1,
    ...overrides,
  });
}

function direWolf(
  id: string,
  displayName: string,
  overrides: Partial<MonsterInstance> = {},
): MonsterInstance {
  return makeTestInstance({
    id,
    monsterKey: "dire-wolf",
    displayName,
    maxHp: 37,
    currentHp: 37,
    armorClass: 14,
    initiative: 10,
    footprint: 2,
    ...overrides,
  });
}

describe("changeMonsterType", () => {
  it("changeMonsterType gives each target the new monster's key, AC, footprint and average max HP and a name numbered after that monster's names in use", () => {
    const { result, repo, rng } = run(
      [
        wolf("w1", "Wolf 1"),
        wolf("w2", "Wolf 2"),
        direWolf("d3", "Dire Wolf 3"),
      ],
      ["w1"],
      "dire-wolf",
      "average",
    );

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.after).toMatchObject({
      id: "w1",
      monsterKey: "dire-wolf",
      displayName: "Dire Wolf 4",
      armorClass: 14,
      footprint: 2,
      maxHp: 37,
      currentHp: 37,
    });
    expect(repo.calls[0]?.changes[0]).toMatchObject({
      id: "w1",
      monsterKey: "dire-wolf",
      displayName: "Dire Wolf 4",
      maxHp: 37,
      armorClass: 14,
      footprint: 2,
    });
    expect(result.rolls).toEqual([]);
    expect(rng.calls).toBe(0);
  });

  it("changeMonsterType keeps each target's id, group, stats visibility and spawn position", () => {
    const target = wolf("w1", "Wolf 1", {
      encounterId: "e7",
      groupId: "g1",
      statsVisible: true,
      spawnPosition: { x: 250, y: 150 },
      createdAt: 42,
    });

    const { result } = run([target], ["w1"], "goblin-boss");

    const changed = result.instances[0];
    expect(changed?.before).toEqual(target);
    expect(changed?.after).toMatchObject({
      id: "w1",
      encounterId: "e7",
      groupId: "g1",
      statsVisible: true,
      spawnPosition: { x: 250, y: 150 },
      createdAt: 42,
    });
  });

  it("changeMonsterType carries the damage taken over to the new max HP and clamps current HP at 0", () => {
    // 6 damage taken: 37 - 6 = 31.
    const up = run(
      [wolf("w1", "Wolf 1", { currentHp: 5 })],
      ["w1"],
      "dire-wolf",
    );
    expect(up.result.instances[0]?.after).toMatchObject({
      maxHp: 37,
      currentHp: 31,
    });
    expect(up.repo.calls[0]?.changes[0]).toMatchObject({
      maxHp: 37,
      currentHp: 31,
    });

    // 34 damage taken is more than a wolf's 11: clamped at 0.
    const down = run(
      [direWolf("d1", "Dire Wolf 1", { currentHp: 3 })],
      ["d1"],
      "wolf",
    );
    expect(down.result.instances[0]?.after).toMatchObject({
      maxHp: 11,
      currentHp: 0,
    });
  });

  it("changeMonsterType keeps the initiative roll with the new monster's modifier, and keeps no initiative as none", () => {
    // Wolf +2 -> Dire Wolf +1: 15 - 2 + 1.
    const { result, repo } = run(
      [
        wolf("w1", "Wolf 1", { initiative: 15 }),
        wolf("w2", "Wolf 2", { initiative: null }),
      ],
      ["w1", "w2"],
      "dire-wolf",
    );

    expect(result.instances.map((c) => c.after.initiative)).toEqual([14, null]);
    expect(repo.calls[0]?.changes.map((c) => c.initiative)).toEqual([14, null]);
  });

  it("changeMonsterType reports the kept roll, and null when the target had no initiative", () => {
    // Wolf +2: 15 - 2 = 13 is the kept roll.
    const { result } = run(
      [
        wolf("w1", "Wolf 1", { initiative: 15 }),
        wolf("w2", "Wolf 2", { initiative: null }),
      ],
      ["w1", "w2"],
      "dire-wolf",
    );

    expect(result.instances.map((c) => c.initiativeRoll)).toEqual([13, null]);
  });

  it("changeMonsterType in rolled mode rolls each target's max HP labelled with its new name and returns the rolls", () => {
    // Every die shows 1: 5d10+10 = 15.
    const { result, rng } = run(
      [wolf("w1", "Wolf 1"), wolf("w2", "Wolf 2")],
      ["w1", "w2"],
      "dire-wolf",
      "rolled",
      cycleRng(0),
    );

    expect(rng.calls).toBe(10);
    expect(result.rolls).toHaveLength(2);
    expect(result.rolls[0]).toMatchObject({
      expression: "5d10+10",
      total: 15,
      label: "Dire Wolf 1 HP",
      timestamp: NOW,
    });
    expect(result.rolls[1]).toMatchObject({
      expression: "5d10+10",
      total: 15,
      label: "Dire Wolf 2 HP",
    });
    expect(result.instances.map((c) => c.after.maxHp)).toEqual([15, 15]);
    expect(result.instances.map((c) => c.after.currentHp)).toEqual([15, 15]);
  });

  it("changeMonsterType numbers several targets in input order and writes them in one changeMonsters call", () => {
    const { result, repo } = run(
      [
        wolf("w1", "Wolf 1"),
        wolf("w2", "Wolf 2"),
        wolf("w3", "Wolf 3"),
        makeTestInstance({
          id: "b2",
          monsterKey: "goblin-boss",
          displayName: "Goblin Boss 2",
          maxHp: 21,
          currentHp: 21,
          armorClass: 17,
        }),
      ],
      ["w3", "w1"],
      "goblin-boss",
    );

    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]?.origin).toEqual(origin);
    expect(repo.calls[0]?.changes.map((c) => [c.id, c.displayName])).toEqual([
      ["w3", "Goblin Boss 3"],
      ["w1", "Goblin Boss 4"],
    ]);
    expect(
      result.instances.map((c) => [c.before.id, c.after.displayName]),
    ).toEqual([
      ["w3", "Goblin Boss 3"],
      ["w1", "Goblin Boss 4"],
    ]);
  });

  it("changeMonsterType reports noLongerFits only for a target whose footprint grew", () => {
    const grow = run(
      [
        wolf("w1", "Wolf 1"),
        makeTestInstance({
          id: "o1",
          monsterKey: "owlbear",
          displayName: "Owlbear 1",
          maxHp: 59,
          currentHp: 59,
          armorClass: 13,
          footprint: 2,
        }),
      ],
      ["w1", "o1"],
      "dire-wolf",
    );
    expect(grow.result.instances.map((c) => c.noLongerFits)).toEqual([
      true,
      false,
    ]);

    const shrink = run([direWolf("d1", "Dire Wolf 1")], ["d1"], "wolf");
    expect(shrink.result.instances.map((c) => c.noLongerFits)).toEqual([false]);
  });

  it("changeMonsterType throws UnknownMonsterError for an unknown monster key and UnknownInstanceError for an unknown id, before any roll or write", () => {
    const instances = [wolf("w1", "Wolf 1")];

    const rng = cycleRng(0);
    const repo = memoryRepo(instances);
    expect(() =>
      changeMonsterType(
        { repo, monsters, rng, now: () => new Date(NOW) },
        ["w1"],
        "tarrasque-jr",
        "rolled",
        origin,
      ),
    ).toThrow(UnknownMonsterError);
    expect(rng.calls).toBe(0);
    expect(repo.calls).toEqual([]);

    expect(() =>
      changeMonsterType(
        { repo, monsters, rng, now: () => new Date(NOW) },
        ["w1", "missing"],
        "dire-wolf",
        "rolled",
        origin,
      ),
    ).toThrow(UnknownInstanceError);
    expect(rng.calls).toBe(0);
    expect(repo.calls).toEqual([]);
  });

  it("changeMonsterType throws UnknownMonsterError before any roll or write when a target with an initiative has a current monster not in the index", () => {
    const rng = cycleRng(0);
    const repo = memoryRepo([
      wolf("w1", "Wolf 1"),
      makeTestInstance({
        id: "x1",
        monsterKey: "homebrew-gone",
        displayName: "Gone 1",
        initiative: 12,
      }),
    ]);

    expect(() =>
      changeMonsterType(
        { repo, monsters, rng, now: () => new Date(NOW) },
        ["w1", "x1"],
        "dire-wolf",
        "rolled",
        origin,
      ),
    ).toThrow(UnknownMonsterError);
    expect(rng.calls).toBe(0);
    expect(repo.calls).toEqual([]);

    // With no initiative the old monster's modifier is not needed.
    const { result } = run(
      [
        makeTestInstance({
          id: "x2",
          monsterKey: "homebrew-gone",
          displayName: "Gone 2",
          initiative: null,
        }),
      ],
      ["x2"],
      "wolf",
    );
    expect(result.instances[0]?.after).toMatchObject({
      monsterKey: "wolf",
      initiative: null,
    });
  });

  it("changeMonsterType throws SameMonsterError before any roll or write when a target already is that monster", () => {
    const rng = cycleRng(0);
    const repo = memoryRepo([
      wolf("w1", "Wolf 1"),
      direWolf("d1", "Dire Wolf 1"),
    ]);

    expect(() =>
      changeMonsterType(
        { repo, monsters, rng, now: () => new Date(NOW) },
        ["w1", "d1"],
        "dire-wolf",
        "rolled",
        origin,
      ),
    ).toThrow(SameMonsterError);
    expect(rng.calls).toBe(0);
    expect(repo.calls).toEqual([]);
  });
});
