import { describe, expect, it } from "vitest";
import {
  DiceParseError,
  average,
  createLogEntry,
  createSeededRng,
  parseDice,
  roll,
  type Rng,
} from "../index.js";

describe("parseDice", () => {
  it("parses spec examples", () => {
    expect(parseDice("5d8 + 5").terms).toEqual([
      { kind: "dice", sign: 1, count: 5, sides: 8 },
      { kind: "constant", sign: 1, value: 5 },
    ]);
    expect(parseDice("2d6").terms).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6 },
    ]);
    expect(parseDice("1d20+3").terms).toEqual([
      { kind: "dice", sign: 1, count: 1, sides: 20 },
      { kind: "constant", sign: 1, value: 3 },
    ]);
    expect(parseDice("d20").terms).toEqual([
      { kind: "dice", sign: 1, count: 1, sides: 20 },
    ]);
    expect(parseDice("3d6 - 1").terms[1]).toEqual({
      kind: "constant",
      sign: -1,
      value: 1,
    });
  });

  it("tolerates whitespace and uppercase D", () => {
    expect(parseDice("  5d8   +   5  ").terms).toEqual(
      parseDice("5d8+5").terms,
    );
    expect(parseDice("\t3D6\n-\n1").terms).toEqual(parseDice("3d6-1").terms);
    expect(parseDice("D20").terms).toEqual(parseDice("d20").terms);
  });

  it.each([
    "",
    "   ",
    "d",
    "2d",
    "0d6",
    "1d0",
    "5d8 +",
    "abc",
    "2d6 2d6",
    "1001d6",
    "d1001",
    "+5",
  ])("rejects %j with DiceParseError", (bad) => {
    expect(() => parseDice(bad)).toThrow(DiceParseError);
  });

  it("rejects over-limit and unsafe constants with a clear message", () => {
    expect(() => parseDice("1d6 + 1000001")).toThrow(DiceParseError);
    expect(() => parseDice("1d6 + 1000001")).toThrow(/constant must be/);
    expect(() => parseDice("99999999999999999999")).toThrow(/constant must be/);
    expect(parseDice("1000000").terms).toEqual([
      { kind: "constant", sign: 1, value: 1_000_000 },
    ]);
  });

  it("reports the count and sides limits in the error message", () => {
    expect(() => parseDice("0d6")).toThrow(
      /dice count must be between 1 and 1000/,
    );
    expect(() => parseDice("1001d6")).toThrow(
      /dice count must be between 1 and 1000/,
    );
    expect(() => parseDice("1d0")).toThrow(
      /dice sides must be between 1 and 1000/,
    );
    expect(() => parseDice("1d1001")).toThrow(
      /dice sides must be between 1 and 1000/,
    );
  });

  it("error message includes the input", () => {
    expect(() => parseDice("5d8 +")).toThrow(/"5d8 \+"/);
  });
});

describe("roll", () => {
  it("stays within bounds and total equals sum of dice plus modifier", () => {
    const rng = createSeededRng(123);
    for (let i = 0; i < 500; i++) {
      const r = roll("5d8 + 5", rng);
      expect(r.dice).toHaveLength(1);
      const dice = r.dice[0] ?? [];
      expect(dice).toHaveLength(5);
      for (const d of dice) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(8);
      }
      expect(r.modifier).toBe(5);
      expect(r.total).toBe(dice.reduce((a, b) => a + b, 0) + 5);
      expect(r.total).toBeGreaterThanOrEqual(10);
      expect(r.total).toBeLessThanOrEqual(45);
    }
  });

  it("subtracts negative terms", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 100; i++) {
      const r = roll("3d6 - 1", rng);
      expect(r.modifier).toBe(-1);
      expect(r.total).toBe((r.dice[0] ?? []).reduce((a, b) => a + b, 0) - 1);
    }
    expect(roll("10 - 1d1", createSeededRng(1)).total).toBe(9);
  });

  it("uses only the injected Rng", () => {
    const calls: number[] = [];
    const rng: Rng = {
      nextInt(max) {
        calls.push(max);
        return max - 1;
      },
    };
    const r = roll("2d6 + 1d4", rng);
    expect(calls).toEqual([6, 6, 4]);
    expect(r.dice).toEqual([[6, 6], [4]]);
    expect(r.total).toBe(16);
  });

  it("golden values for a fixed seed", () => {
    // Changing the generator breaks replay of old seeds; update deliberately.
    expect(roll("5d6", createSeededRng(42)).dice).toEqual([[4, 3, 6, 5, 2]]);
  });

  it("same seed gives same sequence, different seeds diverge", () => {
    const a = roll("20d20", createSeededRng(42));
    const b = roll("20d20", createSeededRng(42));
    const c = roll("20d20", createSeededRng(43));
    expect(a).toEqual(b);
    expect(a.dice).not.toEqual(c.dice);
  });
});

describe("average", () => {
  it.each([
    ["5d8 + 5", 27],
    ["2d6", 7],
    ["1d20+3", 13],
    ["3d6-1", 9],
    ["d20", 10],
    ["1d4", 2],
    ["10 - 1d4", 7],
    ["1 - 1d4", -2], // floors toward -infinity: 1 - 2.5 = -1.5 -> -2
  ])("average(%j) = %i", (expr, expected) => {
    expect(average(expr)).toBe(expected);
  });
});

describe("createLogEntry", () => {
  it("builds an entry with injected time", () => {
    const result = roll("2d6+1", createSeededRng(5));
    const entry = createLogEntry(result, new Date("2026-01-02T03:04:05.000Z"));
    expect(entry).toEqual({
      expression: "2d6+1",
      dice: result.dice,
      total: result.total,
      timestamp: "2026-01-02T03:04:05.000Z",
    });
  });
});
