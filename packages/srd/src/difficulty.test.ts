import { describe, expect, it } from "vitest";
import { assessDifficulty } from "@ttrpg-agents/engine";
import { loadSrdDifficultyTables, loadSrdMonsters } from "./loader.js";

function assess(
  size: number,
  level: number,
  hypothetical: { monsterKey: string; count: number }[],
) {
  const monsters = loadSrdMonsters();
  return assessDifficulty(
    {
      tables: loadSrdDifficultyTables(),
      monsters: { get: (k) => monsters.byKey.get(k) },
    },
    { instances: [], hypothetical, party: { size, level } },
  );
}

describe("SRD difficulty tables", () => {
  it("loads the committed difficulty tables without error", () => {
    const tables = loadSrdDifficultyTables();
    expect(tables.xpByCr.length).toBeGreaterThan(0);
    expect(tables.budgetPerCharacter).toHaveLength(20);
  });

  it("gives CR 0 an XP of 10", () => {
    const row = loadSrdDifficultyTables().xpByCr.find((r) => r.cr === 0);
    expect(row?.xp).toBe(10);
  });

  it("four level 1 characters have a Low budget of 200 and a Bugbear Warrior, two Giant Wasps or six Giant Rats come to 200, 200 and 150 XP", () => {
    const groups = [
      [{ monsterKey: "srd-2024_bugbear-warrior", count: 1 }],
      [{ monsterKey: "srd-2024_giant-wasp", count: 2 }],
      [{ monsterKey: "srd-2024_giant-rat", count: 6 }],
    ];
    const results = groups.map((g) => assess(4, 1, g));
    expect(results[0]?.party.budgets.low).toBe(200);
    expect(results.map((r) => r.totals.xp)).toEqual([200, 200, 150]);
    expect(results.map((r) => r.band)).toEqual(["low", "low", "low"]);
  });

  it("five level 3 characters have a Moderate budget of 1125, met exactly by two Druids and nine Stirges, and one Wight, one Warhorse Skeleton and six Skeletons come to 1100", () => {
    const druids = assess(5, 3, [
      { monsterKey: "srd-2024_druid", count: 2 },
      { monsterKey: "srd-2024_stirge", count: 9 },
    ]);
    const undead = assess(5, 3, [
      { monsterKey: "srd-2024_wight", count: 1 },
      { monsterKey: "srd-2024_warhorse-skeleton", count: 1 },
      { monsterKey: "srd-2024_skeleton", count: 6 },
    ]);
    expect(druids.party.budgets.moderate).toBe(1125);
    expect(druids.totals.xp).toBe(1125);
    expect(druids.band).toBe("moderate");
    expect(undead.totals.xp).toBe(1100);
    expect(undead.band).toBe("moderate");
  });

  it("six level 15 characters have a High budget of 46800 and two Adult Red Dragons and two Fire Giants come to 46000", () => {
    const result = assess(6, 15, [
      { monsterKey: "srd-2024_adult-red-dragon", count: 2 },
      { monsterKey: "srd-2024_fire-giant", count: 2 },
    ]);
    expect(result.party.budgets.high).toBe(46800);
    expect(result.totals.xp).toBe(46000);
    expect(result.band).toBe("high");
  });

  it("every CR used by a monster in the SRD snapshot has an XP row", () => {
    const rows = new Set(loadSrdDifficultyTables().xpByCr.map((r) => r.cr));
    const missing = loadSrdMonsters()
      .monsters.map((m) => m.cr)
      .filter((cr) => !rows.has(cr));
    expect([...new Set(missing)]).toEqual([]);
  });
});
