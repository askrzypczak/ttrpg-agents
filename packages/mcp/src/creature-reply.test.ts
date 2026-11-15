import type {
  CheckFinding,
  EntryReport,
  MonsterCheck,
} from "@ttrpg-agents/engine";
import { describe, expect, it } from "vitest";
import { formatCreatureCheck } from "./creature-reply.js";

function entry(
  fields: Pick<EntryReport, "section" | "position" | "name"> &
    Partial<EntryReport>,
): EntryReport {
  return { rolls: false, saves: [], dice: [], ...fields };
}

const bite = entry({
  section: "actions",
  position: 0,
  name: "Bite",
  rolls: true,
  attack: {
    kind: "melee",
    bonus: 4,
    reach: 5,
    damage: [
      { average: 6, dice: "1d8 + 2", type: "Piercing" },
      { average: 3, dice: "1d6", type: "Poison" },
    ],
  },
  dice: [
    { dice: "1d8 + 2", average: 6 },
    { dice: "1d6", average: 3 },
  ],
});
const spellcasting = entry({
  section: "actions",
  position: 1,
  name: "Spellcasting",
  rolls: true,
  spellcasting: { saveDc: 13, attackBonus: 5 },
});
const thornVolley = entry({
  section: "bonusActions",
  position: 0,
  name: "Thorn Volley",
  rolls: true,
  attack: {
    kind: "ranged",
    bonus: 3,
    range: { normal: 80, long: 320 },
    damage: [{ average: 1, type: "Piercing" }],
  },
});
const sporeBurst = entry({
  section: "legendaryActions",
  position: 0,
  name: "Spore Burst",
  rolls: true,
  saves: [
    {
      ability: "con",
      dc: 12,
      failure: [{ average: 7, dice: "2d6", type: "Poison" }],
    },
  ],
  dice: [{ dice: "2d6", average: 7 }],
});
const regrowth = entry({
  section: "traits",
  position: 0,
  name: "Regrowth",
  rolls: true,
  dice: [{ dice: "2d6", average: 7 }],
});
const mossyHide = entry({ section: "traits", position: 1, name: "Mossy Hide" });
const multiattack = entry({
  section: "actions",
  position: 2,
  name: "Multiattack",
});

const lines = (check: MonsterCheck): string[] =>
  formatCreatureCheck(check).split("\n");

describe("formatCreatureCheck", () => {
  it("formatCreatureCheck lists each rolling entry with its section and numbers: attack bonus, reach or range and damage; save ability, DC and failure damage; else its dice", () => {
    const out = lines({
      entries: [
        regrowth,
        mossyHide,
        bite,
        spellcasting,
        multiattack,
        thornVolley,
        sporeBurst,
      ],
      findings: [],
    });

    const rolls = out.indexOf("Rolls:");
    expect(rolls).toBeGreaterThanOrEqual(0);
    const expected = [
      "- Regrowth (trait): dice 7 (2d6)",
      "- Bite (action): melee attack +4, reach 5 ft., 6 (1d8 + 2) Piercing plus 3 (1d6) Poison",
      "- Spellcasting (action): spell save DC 13; spell attack +5",
      "- Thorn Volley (bonus action): ranged attack +3, range 80/320 ft., 1 Piercing",
    ];
    for (const line of expected) expect(out).toContain(line);
    const save = out.findIndex((l) =>
      /^- Spore Burst \(legendary action\): (Constitution|CON) save DC 12, failure 7 \(2d6\) Poison$/.test(
        l,
      ),
    );
    expect(save).toBe(rolls + 5);
    expect(out.slice(rolls + 1, rolls + 5)).toEqual(expected);
    expect(out.some((l) => l.startsWith("- Mossy Hide"))).toBe(false);
    expect(out.some((l) => l.startsWith("- Multiattack"))).toBe(false);
  });

  it("formatCreatureCheck lists the text-only entries on one line with their sections, and says none for an empty list", () => {
    expect(
      lines({ entries: [mossyHide, bite, multiattack], findings: [] }),
    ).toContain("Text only: Mossy Hide (trait), Multiattack (action)");
    expect(lines({ entries: [bite], findings: [] })).toContain(
      "Text only: none",
    );
  });

  it("formatCreatureCheck lists each finding with its found value and every expected value, then the edit_creature line, and says none without findings", () => {
    const findings: CheckFinding[] = [
      {
        code: "attack_bonus",
        entry: { section: "actions", position: 0, name: "Bite" },
        found: 7,
        expected: [3, 4],
        byAbility: { str: 3, dex: 4, con: 2, int: 2, wis: 2, cha: 2 },
      },
      {
        code: "damage_average",
        entry: { section: "actions", position: 0, name: "Bite" },
        found: 9,
        expected: [6],
        dice: "1d8 + 2",
      },
      {
        code: "spell_save_dc",
        entry: { section: "actions", position: 1, name: "Spellcasting" },
        found: 16,
        expected: [13],
      },
      {
        code: "spell_attack_bonus",
        entry: { section: "actions", position: 1, name: "Spellcasting" },
        found: 8,
        expected: [5],
      },
      {
        code: "save_dc",
        entry: {
          section: "legendaryActions",
          position: 0,
          name: "Spore Burst",
        },
        found: 15,
        expected: [11, 12],
      },
      { code: "save_modifier", field: "saves.dex", found: 5, expected: [1, 3] },
      {
        code: "initiative",
        field: "initiativeModifier",
        found: 6,
        expected: [1, 3, 5],
      },
    ];

    const out = lines({
      entries: [bite, spellcasting, sporeBurst],
      findings,
    });

    const start = out.indexOf("Findings:");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(out.slice(start + 1)).toEqual([
      "- Bite (action): attack bonus +7; expected +3, +4",
      "- Bite (action): damage average 9 for 1d8 + 2; expected 6",
      "- Spellcasting (action): spell save DC 16; expected 13",
      "- Spellcasting (action): spell attack bonus +8; expected +5",
      "- Spore Burst (legendary action): save DC 15; expected 11, 12",
      "- DEX save +5; expected +1, +3",
      "- initiative +6; expected +1, +3, +5",
      "Fix a finding with edit_creature, or keep the value if the book prints it on purpose.",
    ]);

    const clean = formatCreatureCheck({ entries: [bite], findings: [] });
    expect(clean.split("\n")).toContain("Findings: none");
    expect(clean).not.toContain("edit_creature");
  });
});
