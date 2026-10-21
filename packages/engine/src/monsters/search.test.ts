import { describe, expect, it } from "vitest";
import type { Monster } from "./schema.js";
import { getMonsterByKey, searchMonsters } from "./search.js";
import type { MonsterIndex } from "./types.js";

function stub(key: string, name: string): Monster {
  return {
    key,
    name,
    source: "private",
    size: "medium",
    type: "beast",
    alignment: "unaligned",
    ac: 10,
    armorDetail: "",
    hp: { average: 5, dice: "1d8 + 1" },
    speeds: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    initiativeModifier: 0,
    cr: 0,
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

const monsters = [
  stub("wolf", "Wolf"),
  stub("wolf-guardian", "Wolf Guardian"),
  stub("dire-wolf", "Dire Wolf"),
  stub("werewolf", "Werewolf"),
  stub("harpy", "Harpy"),
  stub("ogre", "Ogre"),
];
const index: MonsterIndex = {
  monsters,
  byKey: new Map(monsters.map((m) => [m.key, m] as const)),
};
const names = (q: string) => searchMonsters(index, q).map((m) => m.name);

describe("searchMonsters", () => {
  it("finds a name case-insensitively and ignoring surrounding whitespace", () => {
    for (const q of ["Harpy", "HARPY", "harpy", "  harpy "]) {
      expect(names(q)).toEqual(["Harpy"]);
    }
  });

  it("tolerates plurals (-s and -ies)", () => {
    expect(names("ogres")).toEqual(["Ogre"]);
    expect(names("harpies")).toEqual(["Harpy"]);
  });

  it("ranks exact, then prefix, then word, then substring matches", () => {
    expect(names("wolf")).toEqual([
      "Wolf", // exact
      "Wolf Guardian", // prefix
      "Dire Wolf", // whole word
      "Werewolf", // substring only
    ]);
  });

  it("returns [] for no match or a blank query, and treats regex characters literally", () => {
    expect(names("zzzqx")).toEqual([]);
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    expect(names(".*")).toEqual([]);
    expect(names("w.lf")).toEqual([]);
  });
});

describe("getMonsterByKey", () => {
  it("returns the monster for a known key and undefined otherwise", () => {
    expect(getMonsterByKey(index, "dire-wolf")?.name).toBe("Dire Wolf");
    expect(getMonsterByKey(index, "nope")).toBeUndefined();
    expect(getMonsterByKey(index, "Dire Wolf")).toBeUndefined();
  });
});
