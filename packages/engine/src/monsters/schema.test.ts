import { describe, expect, it } from "vitest";
import { monsterSchema, type Monster } from "./schema.js";

function stub(hp: Monster["hp"]): Monster {
  return {
    key: "test-beast",
    name: "Test Beast",
    source: "private",
    size: "medium",
    type: "beast",
    alignment: "unaligned",
    ac: 10,
    armorDetail: "",
    hp,
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

describe("monsterSchema hp", () => {
  it("accepts hp whose dice parse and whose average matches, floored (1d8 -> 4)", () => {
    const result = monsterSchema.safeParse(stub({ average: 4, dice: "1d8" }));
    expect(result.success).toBe(true);
  });

  it("rejects unparseable hp.dice with an issue at hp.dice", () => {
    const result = monsterSchema.safeParse(
      stub({ average: 4, dice: "lots of dice" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual([
      "hp",
      "dice",
    ]);
  });

  it("rejects an hp.average that differs from the dice average, issue at hp.average naming both numbers", () => {
    // 2d6 + 3 averages 10.
    const result = monsterSchema.safeParse(
      stub({ average: 12, dice: "2d6 + 3" }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find(
      (i) => i.path.join(".") === "hp.average",
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/\b12\b/);
    expect(issue?.message).toMatch(/\b10\b/);
  });
});
