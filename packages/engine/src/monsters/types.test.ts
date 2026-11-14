import { describe, expect, it } from "vitest";
import type { Monster } from "./schema.js";
import { staticMonsterIndex, type MonsterSet } from "./types.js";

function creature(key: string, name: string): Monster {
  return {
    key,
    name,
    source: { book: "homebrew" },
    size: "small",
    type: "fey",
    alignment: "neutral",
    ac: 11,
    armorDetail: "",
    hp: { average: 4, dice: "1d8" },
    speeds: { walk: 25 },
    abilities: { str: 8, dex: 12, con: 10, int: 9, wis: 11, cha: 13 },
    initiativeModifier: 1,
    cr: 0,
    saves: { str: -1, dex: 1, con: 0, int: -1, wis: 0, cha: 1 },
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

function setOf(
  monsters: Monster[],
  aliases: Record<string, string> = {},
  dndBeyondPages: Record<string, string> = {},
): MonsterSet {
  return {
    monsters,
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(Object.entries(aliases)),
    dndBeyondPages: new Map(Object.entries(dndBeyondPages)),
  };
}

describe("staticMonsterIndex", () => {
  it("staticMonsterIndex gets each monster of its set by key, lists them in set order, and gives undefined for an unknown key", () => {
    const thornling = creature("homebrew_thornling", "Thornling");
    const mossback = creature("homebrew_mossback", "Mossback");
    const puddlewisp = creature("homebrew_puddlewisp", "Puddlewisp");
    const index = staticMonsterIndex(setOf([thornling, mossback, puddlewisp]));

    expect(index.get("homebrew_thornling")).toBe(thornling);
    expect(index.get("homebrew_mossback")).toBe(mossback);
    expect(index.get("homebrew_puddlewisp")).toBe(puddlewisp);
    expect(index.list()).toEqual([thornling, mossback, puddlewisp]);
    expect(index.get("homebrew_nobody")).toBeUndefined();
  });

  it("staticMonsterIndex serves the set's aliases and a monster's D&D Beyond page, undefined for a monster without one", () => {
    const thornling = creature("homebrew_thornling", "Thornling");
    const mossback = creature("homebrew_mossback", "Mossback");
    const index = staticMonsterIndex(
      setOf(
        [thornling, mossback],
        { "Bramble Imp": "homebrew_thornling" },
        { homebrew_thornling: "9000001-thornling" },
      ),
    );

    expect([...index.aliases()]).toEqual([
      ["Bramble Imp", "homebrew_thornling"],
    ]);
    expect(index.dndBeyondPage("homebrew_thornling")).toBe("9000001-thornling");
    expect(index.dndBeyondPage("homebrew_mossback")).toBeUndefined();
  });
});
