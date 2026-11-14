import { describe, expect, it } from "vitest";
import { checkMonster, type CheckFinding } from "./check.js";
import type { Monster, MonsterEntry } from "./schema.js";

type Statblock = Omit<Monster, "source">;
type Sections = Monster["sections"];

// CR 2 (proficiency +2). Modifiers: STR +3, DEX +2, CON +1, INT -1, WIS +0, CHA -2.
// Attack and spell attack bonuses that fit: 0..5. Save DCs that fit: 8..13.
const base: Statblock = {
  key: "invented_thornback-skulker",
  name: "Thornback Skulker",
  size: "medium",
  type: "monstrosity",
  alignment: "unaligned",
  ac: 13,
  armorDetail: "",
  hp: { average: 22, dice: "4d8 + 4" },
  speeds: { walk: 30 },
  abilities: { str: 16, dex: 14, con: 12, int: 8, wis: 10, cha: 6 },
  initiativeModifier: 2,
  cr: 2,
  saves: { str: 3, dex: 2, con: 1, int: -1, wis: 0, cha: -2 },
  skills: {},
  senses: { passivePerception: 10 },
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

function statblock(
  sections: Partial<Sections> = {},
  overrides: Partial<Statblock> = {},
): Monster {
  const block: Statblock = {
    ...base,
    ...overrides,
    sections: overrides.sections ?? { ...base.sections, ...sections },
  };
  // The check never reads `source`, so the statblock leaves it out.
  return block as Monster;
}

function entry(name: string, desc: string): MonsterEntry {
  return { name, desc };
}

/** A statblock with one action. */
function action(desc: string, name = "Gouge"): Monster {
  return statblock({ actions: [entry(name, desc)] });
}

function onlyEntry(desc: string) {
  const report = checkMonster(action(desc));
  expect(report.entries).toHaveLength(1);
  return report.entries[0]!;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("checkMonster entry report", () => {
  it("reads a melee attack's bonus, reach and damage", () => {
    const e = onlyEntry(
      "Melee Attack Roll: +5, reach 10 ft. 10 (2d6 + 3) Slashing damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 5,
      reach: 10,
      damage: [{ average: 10, dice: "2d6 + 3", type: "Slashing" }],
    });
    expect(e.attack?.range).toBeUndefined();
  });

  it("reads a ranged attack's normal and long range", () => {
    const e = onlyEntry(
      "Ranged Attack Roll: +4, range 80/320 ft. 7 (2d4 + 2) Piercing damage.",
    );
    expect(e.attack).toEqual({
      kind: "ranged",
      bonus: 4,
      range: { normal: 80, long: 320 },
      damage: [{ average: 7, dice: "2d4 + 2", type: "Piercing" }],
    });
    expect(e.attack?.reach).toBeUndefined();
  });

  it("reads a melee or ranged attack's reach and range", () => {
    const e = onlyEntry(
      "Melee or Ranged Attack Roll: +5, reach 5 ft. or range 20/60 ft. 8 (2d4 + 3) Piercing damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee or ranged",
      bonus: 5,
      reach: 5,
      range: { normal: 20, long: 60 },
      damage: [{ average: 8, dice: "2d4 + 3", type: "Piercing" }],
    });
  });

  it('reads the bonus when "to hit" follows it', () => {
    const e = onlyEntry(
      "Melee Attack Roll: +4 to hit, reach 5 ft. 7 (2d6) Bludgeoning damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 4,
      reach: 5,
      damage: [{ average: 7, dice: "2d6", type: "Bludgeoning" }],
    });
  });

  it("reads the bonus when a parenthetical follows it", () => {
    const e = onlyEntry(
      "Melee Attack Roll: +3 (+5 while the skulker is hidden), reach 5 ft. 7 (2d6) Bludgeoning damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 3,
      reach: 5,
      damage: [{ average: 7, dice: "2d6", type: "Bludgeoning" }],
    });
  });

  it('reads "feet" in place of "ft."', () => {
    const report = checkMonster(
      statblock({
        actions: [
          entry(
            "Lash",
            "Melee Attack Roll: +5, reach 10 feet. 7 (2d6) Slashing damage.",
          ),
          entry(
            "Spine",
            "Ranged Attack Roll: +4, range 30/90 feet 5 (2d4) Piercing damage.",
          ),
        ],
      }),
    );
    expect(report.entries[0]?.attack).toEqual({
      kind: "melee",
      bonus: 5,
      reach: 10,
      damage: [{ average: 7, dice: "2d6", type: "Slashing" }],
    });
    expect(report.entries[1]?.attack).toEqual({
      kind: "ranged",
      bonus: 4,
      range: { normal: 30, long: 90 },
      damage: [{ average: 5, dice: "2d4", type: "Piercing" }],
    });
  });

  it('reads the damage after "Hit:"', () => {
    const e = onlyEntry(
      "Melee Attack Roll: +5, reach 5 ft. Hit: 9 (2d6 + 2) Piercing damage.",
    );
    expect(e.attack?.damage).toEqual([
      { average: 9, dice: "2d6 + 2", type: "Piercing" },
    ]);
  });

  it("reads flat damage as an average with no dice", () => {
    const e = onlyEntry(
      "Melee Attack Roll: +3, reach 5 ft. Hit: 1 Piercing damage.",
    );
    expect(e.attack?.damage).toHaveLength(1);
    expect(e.attack?.damage[0]).toStrictEqual({ average: 1, type: "Piercing" });
  });

  it('chains damage parts joined by "plus" and stops at a comma', () => {
    const report = checkMonster(
      statblock({
        actions: [
          entry(
            "Searing Bite",
            "Melee Attack Roll: +5, reach 5 ft. Hit: 7 (2d4 + 2) Slashing damage plus 7 (2d6) Fire damage plus 3 Cold damage, plus 5 (2d4) Slashing damage if the attack roll had Advantage.",
          ),
          entry(
            "Heavy Hook",
            "Melee Attack Roll: +5, reach 5 ft. Hit: 7 (2d4 + 2) Piercing damage, or 9 (2d6 + 2) Piercing damage if used with two hands.",
          ),
        ],
      }),
    );
    expect(report.entries[0]?.attack?.damage).toEqual([
      { average: 7, dice: "2d4 + 2", type: "Slashing" },
      { average: 7, dice: "2d6", type: "Fire" },
      { average: 3, type: "Cold" },
    ]);
    expect(report.entries[1]?.attack?.damage).toEqual([
      { average: 7, dice: "2d4 + 2", type: "Piercing" },
    ]);
  });

  it("reports an attack with no damage after its reach as an attack with no damage parts", () => {
    const e = onlyEntry(
      "Melee Attack Roll: +5, reach 15 ft. The target has the Grappled condition (escape DC 13) and later takes 7 (2d6) Bludgeoning damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 5,
      reach: 15,
      damage: [],
    });
  });

  it("reads a saving throw's ability, DC and failure damage", () => {
    const e = onlyEntry(
      "Constitution Saving Throw: DC 11, each creature in a 15-foot Cone. Failure: 14 (4d6) Poison damage. Success: Half damage.",
    );
    expect(e.attack).toBeUndefined();
    expect(e.saves).toEqual([
      {
        ability: "con",
        dc: 11,
        failure: [{ average: 14, dice: "4d6", type: "Poison" }],
      },
    ]);
  });

  it("reports no failure damage when the failure is not damage", () => {
    const e = onlyEntry(
      "Wisdom Saving Throw: DC 10, one creature the skulker can see within 30 feet. Failure: The target has the Frightened condition and later takes 7 (2d6) Psychic damage.",
    );
    expect(e.saves).toEqual([{ ability: "wis", dc: 10, failure: [] }]);
  });

  it("reads a saving throw inside an attack", () => {
    const e = onlyEntry(
      "Melee Attack Roll: +5, reach 5 ft. Hit: 7 (2d4 + 2) Piercing damage. If the target is a creature, it makes a Constitution Saving Throw: DC 11. Failure: 7 (2d6) Poison damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 5,
      reach: 5,
      damage: [{ average: 7, dice: "2d4 + 2", type: "Piercing" }],
    });
    expect(e.saves).toEqual([
      {
        ability: "con",
        dc: 11,
        failure: [{ average: 7, dice: "2d6", type: "Poison" }],
      },
    ]);
  });

  it("reads each of several saving throws with the failure damage that follows it", () => {
    const e = onlyEntry(
      "Strength Saving Throw: DC 13, each creature in a 10-foot Emanation. Failure: 9 (2d8) Bludgeoning damage, and the target has the Prone condition. Then each creature makes a Dexterity Saving Throw: DC 12. Success: The creature is unharmed. Finally each creature makes a Wisdom Saving Throw: DC 11. Failure: 5 (2d4) Psychic damage.",
    );
    expect(e.saves).toEqual([
      {
        ability: "str",
        dc: 13,
        failure: [{ average: 9, dice: "2d8", type: "Bludgeoning" }],
      },
      { ability: "dex", dc: 12, failure: [] },
      {
        ability: "wis",
        dc: 11,
        failure: [{ average: 5, dice: "2d4", type: "Psychic" }],
      },
    ]);
  });

  it("reads the spell save DC and the spell attack bonus", () => {
    const e = onlyEntry(
      "The skulker casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 10, +2 to hit with spell attacks): At will: Glimmer Veil",
    );
    expect(e.spellcasting).toEqual({ saveDc: 10, attackBonus: 2 });
    expect(e.attack).toBeUndefined();
    expect(e.saves).toEqual([]);
  });

  it('reads a save through leftover markup such as "[Area of Effect]|XPHB|"', () => {
    const e = onlyEntry(
      "Each creature in a 20-foot [Area of Effect]|XPHB|Emanation makes a Dexterity Saving Throw: DC 12. Failure: 7 (2d6) Fire damage.",
    );
    expect(e.saves).toEqual([
      {
        ability: "dex",
        dc: 12,
        failure: [{ average: 7, dice: "2d6", type: "Fire" }],
      },
    ]);
  });

  it("reads an attack whose lead is in markdown bold", () => {
    const e = onlyEntry(
      "**Melee Attack Roll:** +5, reach 5 ft. 7 (2d4 + 2) Slashing damage.",
    );
    expect(e.attack).toEqual({
      kind: "melee",
      bonus: 5,
      reach: 5,
      damage: [{ average: 7, dice: "2d4 + 2", type: "Slashing" }],
    });
  });

  it("treats 2014 wording as text: no attack or save, its dice listed", () => {
    const e = onlyEntry(
      "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) slashing damage. The target must succeed on a DC 12 Constitution saving throw or take 7 (2d6) poison damage.",
    );
    expect(e.attack).toBeUndefined();
    expect(e.saves).toEqual([]);
    expect(e.dice).toEqual([
      { dice: "2d4 + 2", average: 7 },
      { dice: "2d6", average: 7 },
    ]);
  });

  it("lists every dice expression in text order with the printed average of each N (dice) pair", () => {
    const e = onlyEntry(
      "The skulker rolls 1d4; on a 4 it deals 7 (2d6) Fire damage, else it gains d8 + 1 temporary hit points, then 3d6-1 more and a bonus of 2d6 + 1d4.",
    );
    expect(e.dice).toEqual([
      { dice: "1d4" },
      { dice: "2d6", average: 7 },
      { dice: "d8 + 1" },
      { dice: "3d6-1" },
      { dice: "2d6" },
      { dice: "1d4" },
    ]);
  });

  it("leaves out a dice expression the dice parser rejects and does not throw", () => {
    const monster = statblock({
      traits: [entry("Odd Luck", "It rolls 0d6, then 1001d6, then 2d4.")],
      actions: [
        entry(
          "Overload",
          "Melee Attack Roll: +5, reach 5 ft. Hit: 3 (1001d6) Fire damage.",
        ),
      ],
    });
    expect(() => checkMonster(monster)).not.toThrow();
    const report = checkMonster(monster);
    expect(report.entries[0]?.dice).toEqual([{ dice: "2d4" }]);
    expect(report.entries[1]?.dice).toEqual([]);
    expect(report.entries[1]?.attack?.damage).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it("marks an entry with an attack, a save or dice as rolling and one with none as not", () => {
    const report = checkMonster(
      statblock({
        actions: [
          entry(
            "Poke",
            "Melee Attack Roll: +3, reach 5 ft. Hit: 1 Piercing damage.",
          ),
          entry(
            "Glare",
            "Wisdom Saving Throw: DC 10, one creature within 30 feet. Failure: The target has the Charmed condition.",
          ),
          entry("Regrowth", "A severed spine regrows 1d4 days later."),
          entry("Amphibious", "The skulker can breathe air and water."),
          entry(
            "Spellcasting",
            "The skulker casts one of the following spells (spell save DC 10, +2 to hit with spell attacks): At will: Glimmer Veil",
          ),
        ],
      }),
    );
    expect(report.entries.map((e) => [e.name, e.rolls])).toEqual([
      ["Poke", true],
      ["Glare", true],
      ["Regrowth", true],
      ["Amphibious", false],
      ["Spellcasting", false],
    ]);
  });

  it("marks Multiattack as not rolling", () => {
    const report = checkMonster(
      statblock({
        actions: [
          entry(
            "Multiattack",
            "The skulker makes two Gouge attacks; on a double hit it deals an extra 7 (2d6) Piercing damage.",
          ),
          entry(" multiAttack ", "The skulker makes three Gouge attacks."),
          entry(
            "Gouge",
            "Melee Attack Roll: +5, reach 5 ft. 7 (2d6) Piercing damage.",
          ),
        ],
      }),
    );
    expect(report.entries.map((e) => [e.name, e.rolls])).toEqual([
      ["Multiattack", false],
      [" multiAttack ", false],
      ["Gouge", true],
    ]);
  });

  it("reports every entry in section order with its 0-based position and name", () => {
    // Keys deliberately out of section order.
    const sections: Sections = {
      legendaryActions: [entry("Lunge", "x"), entry("Shriek", "x")],
      reactions: [entry("Recoil", "x")],
      bonusActions: [entry("Skitter", "x")],
      actions: [entry("Gouge", "x")],
      traits: [entry("Amphibious", "x"), entry("Thorns", "x")],
    };
    const report = checkMonster(statblock({}, { sections }));
    expect(
      report.entries.map(({ section, position, name }) => ({
        section,
        position,
        name,
      })),
    ).toEqual([
      { section: "traits", position: 0, name: "Amphibious" },
      { section: "traits", position: 1, name: "Thorns" },
      { section: "actions", position: 0, name: "Gouge" },
      { section: "bonusActions", position: 0, name: "Skitter" },
      { section: "reactions", position: 0, name: "Recoil" },
      { section: "legendaryActions", position: 0, name: "Lunge" },
      { section: "legendaryActions", position: 1, name: "Shriek" },
    ]);
  });
});

describe("checkMonster findings", () => {
  const gouge = { section: "actions", position: 0, name: "Gouge" } as const;

  it("flags an N (dice) pair whose average is wrong, with found, expected and dice", () => {
    const report = checkMonster(
      action(
        "Melee Attack Roll: +5, reach 5 ft. Hit: 9 (2d6 + 3) Slashing damage.",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "damage_average",
        entry: gouge,
        found: 9,
        expected: [10],
        dice: "2d6 + 3",
      },
    ]);
  });

  it("raises no damage_average finding for a correct pair", () => {
    const report = checkMonster(
      action(
        "Melee Attack Roll: +5, reach 5 ft. Hit: 10 (2d6 + 3) Slashing damage. Constitution Saving Throw: DC 11. Failure: 7 (2d6) Poison damage.",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("checks the N (dice) averages of a 2014-format entry", () => {
    const report = checkMonster(
      action(
        "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 9 (2d4 + 2) slashing damage.",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "damage_average",
        entry: gouge,
        found: 9,
        expected: [7],
        dice: "2d4 + 2",
      },
    ]);
  });

  it("flags an attack bonus no ability fits, with the fitting value per ability", () => {
    const report = checkMonster(
      action(
        "Melee Attack Roll: +7, reach 5 ft. Hit: 7 (2d6) Slashing damage.",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "attack_bonus",
        entry: gouge,
        found: 7,
        expected: [0, 1, 2, 3, 4, 5],
        byAbility: { str: 5, dex: 4, con: 3, int: 1, wis: 2, cha: 0 },
      },
    ]);
  });

  it("accepts an attack bonus that fits an ability other than STR or DEX", () => {
    const report = checkMonster(
      action(
        "Ranged Attack Roll: +1, range 30/120 ft. Hit: 5 (2d4) Psychic damage.",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("flags a save DC that is not 8 + proficiency + any ability modifier, with found and expected", () => {
    const report = checkMonster(
      action(
        "Dexterity Saving Throw: DC 15, each creature in a 10-foot Emanation. Failure: 7 (2d6) Fire damage.",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "save_dc",
        entry: gouge,
        found: 15,
        expected: [8, 9, 10, 11, 12, 13],
      },
    ]);
    expect(report.findings[0]?.byAbility).toBeUndefined();
  });

  it("accepts a save DC that fits an ability", () => {
    const report = checkMonster(
      action(
        "Wisdom Saving Throw: DC 10, one creature within 30 feet. Failure: 7 (2d6) Psychic damage.",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("flags a spell save DC that fits no ability, with found and expected", () => {
    const report = checkMonster(
      action(
        "The skulker casts one of the following spells (spell save DC 16): At will: Glimmer Veil",
        "Spellcasting",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "spell_save_dc",
        entry: { section: "actions", position: 0, name: "Spellcasting" },
        found: 16,
        expected: [8, 9, 10, 11, 12, 13],
      },
    ]);
    expect(report.findings[0]?.byAbility).toBeUndefined();
  });

  it("accepts a spell save DC that fits an ability", () => {
    const report = checkMonster(
      action(
        "The skulker casts one of the following spells, using Intelligence as the spellcasting ability (spell save DC 9): At will: Glimmer Veil",
        "Spellcasting",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("flags a spell attack bonus that fits no ability, with found and expected", () => {
    const report = checkMonster(
      action(
        "The skulker casts one of the following spells (+8 to hit with spell attacks): At will: Thorn Dart",
        "Spellcasting",
      ),
    );
    expect(report.findings).toEqual([
      {
        code: "spell_attack_bonus",
        entry: { section: "actions", position: 0, name: "Spellcasting" },
        found: 8,
        expected: [0, 1, 2, 3, 4, 5],
      },
    ]);
    expect(report.findings[0]?.byAbility).toBeUndefined();
  });

  it("accepts a spell attack bonus that fits an ability", () => {
    const report = checkMonster(
      action(
        "The skulker casts one of the following spells, using Charisma as the spellcasting ability (+0 to hit with spell attacks): At will: Thorn Dart",
        "Spellcasting",
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("flags a saving throw that is neither the modifier nor modifier + proficiency, on its field", () => {
    const report = checkMonster(
      statblock({}, { saves: { ...base.saves, str: 4 } }),
    );
    expect(report.findings).toEqual([
      { code: "save_modifier", field: "saves.str", found: 4, expected: [3, 5] },
    ]);
    expect(report.findings[0]?.entry).toBeUndefined();
  });

  it("accepts a saving throw equal to the modifier or to modifier + proficiency", () => {
    const report = checkMonster(
      statblock(
        {},
        { saves: { str: 5, dex: 2, con: 3, int: -1, wis: 2, cha: -2 } },
      ),
    );
    expect(report.findings).toEqual([]);
  });

  it("flags an initiative that is not DEX + 0, 1 or 2 times proficiency, on its field", () => {
    const report = checkMonster(statblock({}, { initiativeModifier: 3 }));
    expect(report.findings).toEqual([
      {
        code: "initiative",
        field: "initiativeModifier",
        found: 3,
        expected: [2, 4, 6],
      },
    ]);
    expect(report.findings[0]?.entry).toBeUndefined();
  });

  it("accepts an initiative of DEX + 0, 1 or 2 times proficiency", () => {
    for (const initiativeModifier of [2, 4, 6]) {
      const report = checkMonster(statblock({}, { initiativeModifier }));
      expect(report.findings, `initiative ${initiativeModifier}`).toEqual([]);
    }
  });

  it("lists findings by entry, then saving throws, then initiative", () => {
    const report = checkMonster(
      statblock(
        {
          legendaryActions: [
            entry(
              "Quake",
              "Strength Saving Throw: DC 14. Failure: The target has the Prone condition.",
            ),
          ],
          traits: [
            entry(
              "Thorns",
              "A creature that touches it takes 4 (1d6) Piercing damage.",
            ),
          ],
          actions: [
            entry(
              "Ruin",
              "Melee Attack Roll: +7, reach 5 ft. Hit: 9 (2d6 + 3) Slashing damage. The skulker then casts a spell (spell save DC 16, +8 to hit with spell attacks). Strength Saving Throw: DC 15. Failure: 6 (2d4) Fire damage. Dexterity Saving Throw: DC 14. Failure: 8 (2d6) Cold damage.",
            ),
          ],
        },
        {
          saves: { ...base.saves, str: 4, cha: 1 },
          initiativeModifier: 3,
        },
      ),
    );
    const where = (f: CheckFinding): string =>
      f.entry ? `${f.entry.section}[${f.entry.position}]` : (f.field ?? "?");
    expect(report.findings.map((f) => [f.code, where(f), f.found])).toEqual([
      ["damage_average", "traits[0]", 4],
      ["attack_bonus", "actions[0]", 7],
      ["save_dc", "actions[0]", 15],
      ["save_dc", "actions[0]", 14],
      ["spell_save_dc", "actions[0]", 16],
      ["spell_attack_bonus", "actions[0]", 8],
      ["damage_average", "actions[0]", 9],
      ["damage_average", "actions[0]", 6],
      ["damage_average", "actions[0]", 8],
      ["save_dc", "legendaryActions[0]", 14],
      ["save_modifier", "saves.str", 4],
      ["save_modifier", "saves.cha", 1],
      ["initiative", "initiativeModifier", 3],
    ]);
  });

  it("changes nothing it is given", () => {
    const monster = statblock(
      {
        traits: [
          entry(
            "Thorns",
            "A creature that touches it takes 4 (1d6) Piercing damage.",
          ),
        ],
        actions: [
          entry(
            "Ruin",
            "**Melee Attack Roll:** +7, reach 5 ft. Hit: 9 (2d6 + 3) Slashing damage plus 7 (2d6) Fire damage. Strength Saving Throw: DC 15. Failure: 6 (2d4) Fire damage.",
          ),
          entry(
            "Spellcasting",
            "The skulker casts spells (spell save DC 16, +8 to hit with spell attacks).",
          ),
        ],
      },
      { saves: { ...base.saves, str: 4 }, initiativeModifier: 3 },
    );
    const before = structuredClone(monster);
    deepFreeze(monster);
    checkMonster(monster);
    expect(monster).toEqual(before);
  });
});
