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
  stub("tough", "Tough"),
  stub("thunderbird", "Thunderbird"),
  stub("warrior-veteran", "Warrior Veteran"),
  stub("venomous-snake", "Venomous Snake"),
];
const index: MonsterIndex = {
  monsters,
  byKey: new Map(monsters.map((m) => [m.key, m] as const)),
  aliases: new Map([
    ["Thug", "tough"],
    ["Veteran", "warrior-veteran"],
    ["Poisonous Snake", "venomous-snake"],
  ]),
};
const names = (q: string) =>
  searchMonsters(index, q).map((r) => r.monster.name);
const byKey = (key: string): Monster => {
  const m = index.byKey.get(key);
  if (!m) throw new Error(`no stub monster ${key}`);
  return m;
};

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

  it("finds a monster by an alias case-insensitively and plural-tolerantly, marking it as an alias hit", () => {
    for (const q of ["thug", "Thug", "THUG", "thugs", " Thugs "]) {
      expect(searchMonsters(index, q)).toEqual([
        { monster: byKey("tough"), alias: "Thug" },
      ]);
    }
  });

  it("does not mark a match on the current name as an alias hit", () => {
    // The same monster is an alias hit only when its old name is what matched.
    expect(searchMonsters(index, "poisonous snakes")).toEqual([
      { monster: byKey("venomous-snake"), alias: "Poisonous Snake" },
    ]);
    for (const q of ["venomous snake", "Tough"]) {
      const results = searchMonsters(index, q);
      expect(results).toHaveLength(1);
      expect(results[0]).not.toHaveProperty("alias");
    }
    // Name and alias both match "snake" as a whole word: the name wins.
    const snake = searchMonsters(index, "snake");
    expect(snake).toEqual([{ monster: byKey("venomous-snake") }]);
    expect(snake[0]).not.toHaveProperty("alias");
  });

  it("ranks a current-name match above an alias match of the same strength", () => {
    // Both are prefix matches; the name match wins although its name is longer.
    expect(searchMonsters(index, "thu")).toEqual([
      { monster: byKey("thunderbird") },
      { monster: byKey("tough"), alias: "Thug" },
    ]);
  });

  it("lists a monster once, marked as an alias hit, when its alias matches more strongly than its name (veteran -> Warrior Veteran)", () => {
    for (const q of ["veteran", "Veterans"]) {
      expect(searchMonsters(index, q)).toEqual([
        { monster: byKey("warrior-veteran"), alias: "Veteran" },
      ]);
    }
  });
});

describe("getMonsterByKey", () => {
  it("returns the monster for a known key and undefined otherwise", () => {
    expect(getMonsterByKey(index, "dire-wolf")?.name).toBe("Dire Wolf");
    expect(getMonsterByKey(index, "nope")).toBeUndefined();
    expect(getMonsterByKey(index, "Dire Wolf")).toBeUndefined();
  });
});
