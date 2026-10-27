import { describe, expect, it } from "vitest";
import {
  UnknownMonsterError,
  rollInitiativeValues,
  type InitiativeRollDeps,
  type Monster,
  type MonsterIndex,
  type Rng,
} from "../index.js";

function monster(
  key: string,
  name: string,
  initiativeModifier: number,
): Monster {
  return {
    key,
    name,
    source: "private",
    size: "medium",
    type: "humanoid",
    alignment: "neutral",
    ac: 12,
    armorDetail: "",
    hp: { average: 7, dice: "2d6" },
    speeds: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    initiativeModifier,
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

const bestiary = [monster("goblin", "Goblin", 2), monster("ogre", "Ogre", -1)];
const monsters: MonsterIndex = {
  monsters: bestiary,
  byKey: new Map(bestiary.map((m) => [m.key, m] as const)),
};

const NOW = "2026-01-01T00:00:00.000Z";

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

function deps(rng: Rng): InitiativeRollDeps {
  return { monsters, rng, now: () => new Date(NOW) };
}

describe("rollInitiativeValues", () => {
  it("rollInitiativeValues adds the monster's initiative modifier to a 1d20 rolled with the injected rng", () => {
    const rng = cycleRng(13, 4);
    const { outcomes, rolls } = rollInitiativeValues(
      deps(rng),
      [
        { monsterKey: "goblin", displayName: "Goblin 1" },
        { monsterKey: "ogre", displayName: "Ogre 1" },
      ],
      "each",
    );
    expect(outcomes).toEqual([
      { roll: 14, modifier: 2, initiative: 16 },
      { roll: 5, modifier: -1, initiative: 4 },
    ]);
    expect(rolls).toHaveLength(2);
    expect(rolls[0]).toMatchObject({
      expression: "1d20",
      total: 14,
      timestamp: NOW,
    });
    expect(rolls[1]).toMatchObject({
      expression: "1d20",
      total: 5,
      timestamp: NOW,
    });
    expect(rng.calls).toBe(2);
  });

  it('rollInitiativeValues in group mode gives items with the same groupId one shared roll labelled "<Monster> initiative (group)"', () => {
    const rng = cycleRng(9, 2, 15);
    const { outcomes, rolls } = rollInitiativeValues(
      deps(rng),
      [
        { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 2", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 3", groupId: "g1" },
      ],
      "group",
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      label: "Goblin initiative (group)",
      total: 10,
    });
    const shared = { roll: 10, modifier: 2, initiative: 12 };
    expect(outcomes).toEqual([shared, shared, shared]);
  });

  it("rollInitiativeValues in group mode rolls once per distinct groupId, in first-seen order", () => {
    const rng = cycleRng(4, 9);
    const { outcomes, rolls } = rollInitiativeValues(
      deps(rng),
      [
        { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
        { monsterKey: "ogre", displayName: "Ogre 1", groupId: "g2" },
        { monsterKey: "goblin", displayName: "Goblin 2", groupId: "g1" },
        { monsterKey: "ogre", displayName: "Ogre 2", groupId: "g2" },
      ],
      "group",
    );
    expect(rolls.map((r) => [r.label, r.total])).toEqual([
      ["Goblin initiative (group)", 5],
      ["Ogre initiative (group)", 10],
    ]);
    expect(outcomes).toEqual([
      { roll: 5, modifier: 2, initiative: 7 },
      { roll: 10, modifier: -1, initiative: 9 },
      { roll: 5, modifier: 2, initiative: 7 },
      { roll: 10, modifier: -1, initiative: 9 },
    ]);
  });

  it('rollInitiativeValues in group mode rolls alone, labelled "<name> initiative", for an item with no groupId', () => {
    const rng = cycleRng(2, 7, 11);
    const items = [
      { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
      { monsterKey: "ogre", displayName: "Lone Ogre" },
      { monsterKey: "goblin", displayName: "Goblin 2", groupId: "g1" },
      { monsterKey: "goblin", displayName: "Stray", groupId: null },
    ];
    const { outcomes, rolls } = rollInitiativeValues(deps(rng), items, "group");

    expect(rolls).toHaveLength(3);
    expect(rolls.map((r) => r.label).sort()).toEqual([
      "Goblin initiative (group)",
      "Lone Ogre initiative",
      "Stray initiative",
    ]);
    expect(new Set(rolls.map((r) => r.total)).size).toBe(3);
    const totalOf = (label: string): number | undefined =>
      rolls.find((r) => r.label === label)?.total;
    const group = totalOf("Goblin initiative (group)");
    const ogre = totalOf("Lone Ogre initiative");
    const stray = totalOf("Stray initiative");
    if (group === undefined || ogre === undefined || stray === undefined) {
      throw new Error("missing roll");
    }
    expect(outcomes).toEqual([
      { roll: group, modifier: 2, initiative: group + 2 },
      { roll: ogre, modifier: -1, initiative: ogre - 1 },
      { roll: group, modifier: 2, initiative: group + 2 },
      { roll: stray, modifier: 2, initiative: stray + 2 },
    ]);
  });

  it('rollInitiativeValues in each mode rolls once per item, labelled "<name> initiative", even when items share a groupId', () => {
    const rng = cycleRng(0, 6, 19);
    const { outcomes, rolls } = rollInitiativeValues(
      deps(rng),
      [
        { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 2", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 3", groupId: "g1" },
      ],
      "each",
    );
    expect(rolls.map((r) => [r.label, r.total])).toEqual([
      ["Goblin 1 initiative", 1],
      ["Goblin 2 initiative", 7],
      ["Goblin 3 initiative", 20],
    ]);
    expect(outcomes).toEqual([
      { roll: 1, modifier: 2, initiative: 3 },
      { roll: 7, modifier: 2, initiative: 9 },
      { roll: 20, modifier: 2, initiative: 22 },
    ]);
  });

  it("rollInitiativeValues in group mode gives a group mixing monster types one shared roll with its first item's modifier and label", () => {
    const rng = cycleRng(6, 11);
    const { outcomes, rolls } = rollInitiativeValues(
      deps(rng),
      [
        { monsterKey: "ogre", displayName: "Ogre 1", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
        { monsterKey: "goblin", displayName: "Goblin 2", groupId: "g1" },
      ],
      "group",
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({
      label: "Ogre initiative (group)",
      total: 7,
    });
    const shared = { roll: 7, modifier: -1, initiative: 6 };
    expect(outcomes).toEqual([shared, shared, shared]);
    expect(rng.calls).toBe(1);
  });

  it("rollInitiativeValues throws UnknownMonsterError, before any roll, when an item's monster key is not in the index", () => {
    const rng = cycleRng(5);
    expect(() =>
      rollInitiativeValues(
        deps(rng),
        [
          { monsterKey: "goblin", displayName: "Goblin 1", groupId: "g1" },
          { monsterKey: "dragon", displayName: "Dragon 1", groupId: "g2" },
        ],
        "each",
      ),
    ).toThrow(UnknownMonsterError);
    expect(rng.calls).toBe(0);
  });
});
