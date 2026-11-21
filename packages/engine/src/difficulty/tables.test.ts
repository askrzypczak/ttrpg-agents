import { describe, expect, it } from "vitest";
import {
  difficultyTablesSchema,
  xpForCr,
  type DifficultyTables,
} from "./tables.js";

const CRS = [
  0,
  0.125,
  0.25,
  0.5,
  ...Array.from({ length: 30 }, (_, i) => i + 1),
];

/** A complete valid table: one row per CR and per level, XP rising with CR. */
function validTables(): DifficultyTables {
  return {
    xpByCr: CRS.map((cr, i) => ({ cr, xp: 10 + i * 100 })),
    budgetPerCharacter: Array.from({ length: 20 }, (_, i) => {
      const level = i + 1;
      return {
        level,
        low: level * 50,
        moderate: level * 75,
        high: level * 100,
      };
    }),
  };
}

type Issue = { path: PropertyKey[]; message: string };

function issuesOf(input: unknown): Issue[] {
  const result = difficultyTablesSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues;
}

/** A word-bounded match, so "5" does not match inside "15". */
function names(message: string, value: number): boolean {
  return new RegExp(
    `(^|[^\\d.])${String(value).replace(".", "\\.")}($|[^\\d.])`,
  ).test(message);
}

function indexOfCr(tables: DifficultyTables, cr: number): number {
  return tables.xpByCr.findIndex((row) => row.cr === cr);
}

function indexOfLevel(tables: DifficultyTables, level: number): number {
  return tables.budgetPerCharacter.findIndex((row) => row.level === level);
}

describe("difficultyTablesSchema", () => {
  it("difficultyTablesSchema accepts one row for each CR from 0 to 30 and each level from 1 to 20, in any order", () => {
    const tables = validTables();
    const shuffled: DifficultyTables = {
      xpByCr: [...tables.xpByCr].reverse(),
      budgetPerCharacter: [
        ...tables.budgetPerCharacter.slice(10),
        ...tables.budgetPerCharacter.slice(0, 10),
      ],
    };

    for (const input of [tables, shuffled]) {
      const result = difficultyTablesSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    }
  });

  it("difficultyTablesSchema rejects an XP table missing a CR, naming the CR", () => {
    const tables = validTables();
    tables.xpByCr.splice(indexOfCr(tables, 5), 1);

    const issues = issuesOf(tables);

    expect(
      issues.some(
        (issue) =>
          issue.path.length === 1 &&
          issue.path[0] === "xpByCr" &&
          names(issue.message, 5),
      ),
    ).toBe(true);
  });

  it("difficultyTablesSchema rejects an XP table with a CR repeated, naming the CR", () => {
    const tables = validTables();
    const row = tables.xpByCr[indexOfCr(tables, 5)]!;
    tables.xpByCr.push({ ...row });

    const issues = issuesOf(tables);

    expect(
      issues.some(
        (issue) =>
          issue.path.length === 3 &&
          issue.path[0] === "xpByCr" &&
          issue.path[2] === "cr" &&
          tables.xpByCr[issue.path[1] as number]?.cr === 5 &&
          names(issue.message, 5),
      ),
    ).toBe(true);
  });

  it("difficultyTablesSchema rejects XP that decreases as CR rises, naming both CRs", () => {
    const tables = validTables();
    const nine = tables.xpByCr[indexOfCr(tables, 9)]!;
    const ten = indexOfCr(tables, 10);
    tables.xpByCr[ten] = { cr: 10, xp: nine.xp - 1 };

    const issues = issuesOf(tables);

    expect(
      issues.some(
        (issue) =>
          issue.path.length === 3 &&
          issue.path[0] === "xpByCr" &&
          issue.path[2] === "xp" &&
          [9, 10].includes(tables.xpByCr[issue.path[1] as number]?.cr ?? -1) &&
          names(issue.message, 9) &&
          names(issue.message, 10),
      ),
    ).toBe(true);
  });

  it("difficultyTablesSchema rejects a budget table missing a level, naming the level", () => {
    const tables = validTables();
    tables.budgetPerCharacter.splice(indexOfLevel(tables, 7), 1);

    const issues = issuesOf(tables);

    expect(
      issues.some(
        (issue) =>
          issue.path.length === 1 &&
          issue.path[0] === "budgetPerCharacter" &&
          names(issue.message, 7),
      ),
    ).toBe(true);
  });

  it("difficultyTablesSchema rejects a budget table with a level repeated, naming the level", () => {
    const tables = validTables();
    const row = tables.budgetPerCharacter[indexOfLevel(tables, 7)]!;
    tables.budgetPerCharacter.push({ ...row });

    const issues = issuesOf(tables);

    expect(
      issues.some(
        (issue) =>
          issue.path.length === 3 &&
          issue.path[0] === "budgetPerCharacter" &&
          issue.path[2] === "level" &&
          tables.budgetPerCharacter[issue.path[1] as number]?.level === 7 &&
          names(issue.message, 7),
      ),
    ).toBe(true);
  });

  it("difficultyTablesSchema rejects a budget row whose Low is above its Moderate", () => {
    const tables = validTables();
    const i = indexOfLevel(tables, 4);
    const row = tables.budgetPerCharacter[i]!;
    tables.budgetPerCharacter[i] = { ...row, low: row.moderate + 1 };

    const issues = issuesOf(tables);

    expect(issues.map((issue) => issue.path)).toContainEqual([
      "budgetPerCharacter",
      i,
      "moderate",
    ]);
  });

  it("difficultyTablesSchema rejects a budget row whose Moderate is above its High", () => {
    const tables = validTables();
    const i = indexOfLevel(tables, 4);
    const row = tables.budgetPerCharacter[i]!;
    tables.budgetPerCharacter[i] = { ...row, moderate: row.high + 1 };

    const issues = issuesOf(tables);

    expect(issues.map((issue) => issue.path)).toContainEqual([
      "budgetPerCharacter",
      i,
      "high",
    ]);
  });

  it("difficultyTablesSchema rejects a CR row outside 0, 1/8, 1/4, 1/2 and 1 to 30, naming it", () => {
    for (const cr of [31, 2.5, -1]) {
      const tables = validTables();
      tables.xpByCr.push({ cr, xp: 1_000_000 });
      const i = tables.xpByCr.length - 1;

      const issues = issuesOf(tables);

      expect(
        issues.some(
          (issue) =>
            issue.path.length === 3 &&
            issue.path[0] === "xpByCr" &&
            issue.path[1] === i &&
            issue.path[2] === "cr" &&
            names(issue.message, cr),
        ),
      ).toBe(true);
    }
  });

  it("difficultyTablesSchema rejects a level row outside 1 to 20, naming it", () => {
    for (const level of [0, 21]) {
      const tables = validTables();
      tables.budgetPerCharacter.push({
        level,
        low: 100,
        moderate: 200,
        high: 300,
      });
      const i = tables.budgetPerCharacter.length - 1;

      const issues = issuesOf(tables);

      expect(
        issues.some(
          (issue) =>
            issue.path.length === 3 &&
            issue.path[0] === "budgetPerCharacter" &&
            issue.path[1] === i &&
            issue.path[2] === "level" &&
            names(issue.message, level),
        ),
      ).toBe(true);
    }
  });
});

describe("xpForCr", () => {
  // Out of CR order on purpose, and without CR 1/4 or 1/2.
  const tables: DifficultyTables = {
    xpByCr: [
      { cr: 2, xp: 450 },
      { cr: 0, xp: 10 },
      { cr: 1, xp: 200 },
      { cr: 0.125, xp: 25 },
    ],
    budgetPerCharacter: [],
  };

  it("xpForCr returns the XP of the CR's row", () => {
    expect(xpForCr(tables, 0)).toBe(10);
    expect(xpForCr(tables, 0.125)).toBe(25);
    expect(xpForCr(tables, 1)).toBe(200);
    expect(xpForCr(tables, 2, { inLair: false })).toBe(450);
  });

  it("xpForCr with inLair returns the XP of the next CR's row", () => {
    expect(xpForCr(tables, 0, { inLair: true })).toBe(25);
    expect(xpForCr(tables, 0.125, { inLair: true })).toBe(200);
    expect(xpForCr(tables, 1, { inLair: true })).toBe(450);
  });

  it("xpForCr returns undefined for a CR the table lacks, with or without inLair", () => {
    for (const cr of [0.25, 3]) {
      expect(xpForCr(tables, cr)).toBeUndefined();
      expect(xpForCr(tables, cr, { inLair: true })).toBeUndefined();
    }
  });

  it("xpForCr with inLair at the table's highest CR returns that row's XP", () => {
    expect(xpForCr(tables, 2, { inLair: true })).toBe(450);
  });
});
