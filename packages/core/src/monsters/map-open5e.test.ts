import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mapOpen5eCreature,
  monsterSchema,
  type Open5eCreature,
} from "../index.js";

function fixture(name: string): Open5eCreature {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Open5eCreature;
}

describe("mapOpen5eCreature", () => {
  it("maps the shadow", () => {
    const m = mapOpen5eCreature(fixture("open5e-shadow"));
    expect(monsterSchema.safeParse(m).success).toBe(true);
    expect(m).toMatchObject({
      key: "srd-2024_shadow",
      name: "Shadow",
      source: "srd-5.2",
      size: "medium",
      type: "undead",
      alignment: "chaotic evil",
      ac: 12,
      armorDetail: "natural armor",
      hp: { average: 27, dice: "5d8 + 5" },
      speeds: { walk: 40 },
      initiativeModifier: 2,
      cr: 0.5,
      skills: { stealth: 6 },
      abilities: { str: 6, dex: 14, con: 13, int: 6, wis: 10, cha: 8 },
      damageImmunities: ["Necrotic", "Poison"],
    });
    expect(m.damageResistances).toContain("Thunder");
    expect(m.conditionImmunities).toContain("Exhaustion");
    expect(m.sections.legendaryActions).toEqual([]);
  });

  it("omits zero or null speeds and senses", () => {
    const m = mapOpen5eCreature(fixture("open5e-shadow"));
    expect(m.speeds).toEqual({ walk: 40 });
    expect(m.senses).not.toHaveProperty("blindsight");
    expect(m.senses.passivePerception).toBe(10);
  });

  it("splits action types into sections, ordered by statblock position", () => {
    const m = mapOpen5eCreature(fixture("open5e-adult-red-dragon"));
    expect(m.speeds).toEqual({ walk: 40, fly: 80, climb: 40 });
    expect(m.senses).toMatchObject({
      darkvision: 120,
      blindsight: 60,
      passivePerception: 23,
    });
    expect(m.saves.dex).toBe(6);
    expect(m.damageImmunities).toEqual(["Fire"]);
    expect(m.sections.actions.map((a) => a.name)).toEqual([
      "Multiattack",
      "Rend",
      "Fire Breath",
      "Spellcasting",
    ]);
    expect(m.sections.legendaryActions.map((a) => a.name)).toEqual([
      "Commanding Presence",
      "Fiery Rays",
      "Pounce",
    ]);
    expect(m.sections.legendaryActions.every((a) => a.cost === 1)).toBe(true);
    // cost only applies to legendary actions
    expect(m.sections.actions[0]).not.toHaveProperty("cost");
    expect(m.sections.traits[0]?.name).toMatch(/^Legendary Resistance/);
  });

  it("keeps usage limits and form restrictions", () => {
    const m = mapOpen5eCreature(fixture("open5e-adult-red-dragon"));
    const breath = m.sections.actions.find((a) => a.name === "Fire Breath");
    expect(breath?.usage).toEqual({ type: "RECHARGE_ON_ROLL", param: 5 });
    expect(
      m.sections.actions.find((a) => a.name === "Rend"),
    ).not.toHaveProperty("usage");
    const c = fixture("open5e-shadow");
    c.actions = [
      {
        name: "Bite",
        desc: "x",
        action_type: "ACTION",
        limited_to_form: "Vampire Form Only",
      },
    ];
    expect(mapOpen5eCreature(c).sections.actions[0]?.limitedToForm).toBe(
      "Vampire Form Only",
    );
  });

  it("puts reactions and bonus actions in their own sections", () => {
    const c = fixture("open5e-shadow");
    c.actions = [
      { name: "Parry", desc: "x", action_type: "REACTION" },
      { name: "Dash", desc: "y", action_type: "BONUS_ACTION" },
    ];
    const m = mapOpen5eCreature(c);
    expect(m.sections.reactions).toEqual([{ name: "Parry", desc: "x" }]);
    expect(m.sections.bonusActions).toEqual([{ name: "Dash", desc: "y" }]);
    expect(m.sections.actions).toEqual([]);
  });
});
