import { describe, expect, it } from "vitest";
import { dndBeyondUrl } from "./dndbeyond.js";
import type { Monster } from "./schema.js";
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

const wolf = stub("wolf", "Wolf");
const giantFly = stub("giant-fly", "Giant Fly");
const index: MonsterIndex = {
  monsters: [wolf, giantFly],
  byKey: new Map([wolf, giantFly].map((m) => [m.key, m] as const)),
  aliases: new Map(),
  dndBeyondPages: new Map([["wolf", "5195300-wolf"]]),
};

describe("dndBeyondUrl", () => {
  it("dndBeyondUrl gives the D&D Beyond monsters URL for a monster with a page", () => {
    expect(dndBeyondUrl(index, wolf)).toBe(
      "https://www.dndbeyond.com/monsters/5195300-wolf",
    );
  });

  it("dndBeyondUrl gives undefined for a monster without a page", () => {
    expect(dndBeyondUrl(index, giantFly)).toBeUndefined();
  });
});
