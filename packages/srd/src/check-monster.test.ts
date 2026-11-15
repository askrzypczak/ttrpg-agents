import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  checkMonster,
  monsterSchema,
  type Monster,
} from "@ttrpg-agents/engine";

function readMonsters(url: URL): Monster[] {
  return z.array(monsterSchema).parse(JSON.parse(readFileSync(url, "utf8")));
}

const srd = readMonsters(
  new URL("../data/srd-5.2/monsters.json", import.meta.url),
);
const testBook = readMonsters(
  new URL("../../../fixtures/test-book/creatures.json", import.meta.url),
);

/** Every finding of every statblock, tagged with the statblock's key. */
function findingsOf(monsters: Monster[]) {
  return monsters.flatMap((m) =>
    checkMonster(m).findings.map((f) => ({
      key: m.key,
      code: f.code,
      where: f.entry
        ? {
            section: f.entry.section,
            position: f.entry.position,
            name: f.entry.name,
          }
        : { field: f.field },
      found: f.found,
      expected: f.expected,
      byAbility: f.byAbility,
      dice: f.dice,
    })),
  );
}

describe("checkMonster over committed statblocks", () => {
  it("finds an attack in 423 entries and a save in 196 entries of the SRD snapshot", () => {
    const entries = srd.flatMap((m) => checkMonster(m).entries);
    expect(entries.filter((e) => e.attack !== undefined)).toHaveLength(423);
    expect(entries.filter((e) => e.saves.length > 0)).toHaveLength(196);
  });

  it("reports exactly the pinned findings over the SRD snapshot", () => {
    const found = findingsOf(srd);
    expect(found).toEqual([
      {
        key: "srd-2024_adult-bronze-dragon",
        code: "spell_save_dc",
        where: { section: "actions", position: 4, name: "Spellcasting" },
        found: 17,
        expected: [13, 15, 16, 18, 19, 20],
      },
      {
        key: "srd-2024_adult-bronze-dragon",
        code: "save_dc",
        where: {
          section: "legendaryActions",
          position: 2,
          name: "Thunderclap",
        },
        found: 17,
        expected: [13, 15, 16, 18, 19, 20],
      },
      {
        key: "srd-2024_ancient-white-dragon",
        code: "save_dc",
        where: {
          section: "legendaryActions",
          position: 0,
          name: "Freezing Burst",
        },
        found: 20,
        expected: [14, 15, 18, 22],
      },
      {
        key: "srd-2024_archmage",
        code: "initiative",
        where: { field: "initiativeModifier" },
        found: 7,
        expected: [2, 6, 10],
      },
      {
        key: "srd-2024_octopus",
        code: "save_modifier",
        where: { field: "saves.con" },
        found: 30,
        expected: [-5, -3],
      },
      {
        key: "srd-2024_octopus",
        code: "save_modifier",
        where: { field: "saves.cha" },
        found: -3,
        expected: [-7, -5],
      },
      {
        key: "srd-2024_sphinx-of-valor",
        code: "save_dc",
        where: {
          section: "legendaryActions",
          position: 1,
          name: "Weight of Years",
        },
        found: 16,
        expected: [14, 17, 18, 19, 20],
      },
      {
        key: "srd-2024_swarm-of-ravens",
        code: "save_dc",
        where: { section: "actions", position: 1, name: "Cacophony" },
        found: 10,
        expected: [7, 8, 11, 12],
      },
    ]);
    for (const f of found) {
      expect(f.byAbility, `${f.key} ${f.code}`).toBeUndefined();
      expect(f.dice, `${f.key} ${f.code}`).toBeUndefined();
    }
  });

  it("reports exactly one finding over the test book: damage_average on the Ashfeather Harrier's Talons", () => {
    expect(findingsOf(testBook)).toEqual([
      {
        key: "test-book_ashfeather-harrier",
        code: "damage_average",
        where: { section: "actions", position: 0, name: "Talons" },
        found: 9,
        expected: [10],
        dice: "2d6 + 3",
      },
    ]);
  });
});
