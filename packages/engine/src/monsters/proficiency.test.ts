import { describe, expect, it } from "vitest";
import { proficiencyBonus } from "./proficiency.js";

describe("proficiencyBonus", () => {
  it("gives +2 from CR 0 to CR 4, fractions included", () => {
    for (const cr of [0, 0.125, 0.25, 0.5, 1, 2, 3, 4]) {
      expect(proficiencyBonus(cr), `CR ${cr}`).toBe(2);
    }
  });

  it("rises by 1 every 4 CR, from +3 at CR 5 to +9 at CR 30", () => {
    const table: [number, number][] = [
      [5, 3],
      [8, 3],
      [9, 4],
      [12, 4],
      [13, 5],
      [16, 5],
      [17, 6],
      [20, 6],
      [21, 7],
      [24, 7],
      [25, 8],
      [28, 8],
      [29, 9],
      [30, 9],
    ];
    for (const [cr, bonus] of table) {
      expect(proficiencyBonus(cr), `CR ${cr}`).toBe(bonus);
    }
  });
});
