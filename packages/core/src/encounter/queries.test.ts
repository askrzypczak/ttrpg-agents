import { describe, expect, it } from "vitest";
import { TargetError, compareByInitiative, resolveTargets } from "./queries.js";
import type { MonsterInstance } from "./types.js";

function inst(
  id: string,
  displayName: string,
  initiative: number | null = null,
  createdAt = 1000,
): MonsterInstance {
  return {
    id,
    encounterId: "enc",
    monsterKey: "srd-2024_goblin-warrior",
    displayName,
    maxHp: 7,
    currentHp: 7,
    initiative,
    groupId: null,
    createdAt,
  };
}

function targetError(fn: () => unknown): TargetError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TargetError);
    return e as TargetError;
  }
  throw new Error("expected a TargetError");
}

describe("resolveTargets", () => {
  const a = inst("a1", "Goblin 1");
  const b = inst("b1", "Goblin 2");

  it("resolveTargets resolves by id", () => {
    expect(resolveTargets([a, b], ["b1"])).toEqual([b]);
  });

  it("resolveTargets resolves by exact display name", () => {
    expect(resolveTargets([a, b], ["Goblin 2"])).toEqual([b]);
    expect(() => resolveTargets([a, b], ["goblin 2"])).toThrow(TargetError);
  });

  it("resolveTargets prefers an id match over a display-name match", () => {
    const byId = inst("Boss", "Orc 1");
    const byName = inst("o2", "Boss");
    expect(resolveTargets([byName, byId], ["Boss"])).toEqual([byId]);
  });

  it("resolveTargets returns each instance once when targets overlap", () => {
    const c = inst("c1", "Goblin 3");
    expect(
      resolveTargets([a, b, c], ["Goblin 2", "a1", "b1", "Goblin 2", "a1"]),
    ).toEqual([b, a]);
  });

  it("resolveTargets throws TargetError listing every unresolved target", () => {
    const error = targetError(() =>
      resolveTargets([a, b], ["Ghost", "a1", "Wraith"]),
    );
    expect(error.code).toBe("target");
    expect(error.unresolved).toEqual(["Ghost", "Wraith"]);
    expect(error.ambiguous).toEqual([]);
    expect(error.message).toBe(
      'Unknown target "Ghost"; Unknown target "Wraith"',
    );
  });

  it("resolveTargets throws TargetError listing every ambiguous target", () => {
    const twins = [
      inst("t1", "Twin"),
      inst("t2", "Twin"),
      inst("p1", "Pair"),
      inst("p2", "Pair"),
      a,
    ];
    const error = targetError(() =>
      resolveTargets(twins, ["Twin", "a1", "Pair"]),
    );
    expect(error.ambiguous).toEqual(["Twin", "Pair"]);
    expect(error.unresolved).toEqual([]);
  });

  it("TargetError message for a single unknown or ambiguous target matches the current wording", () => {
    const twins = [inst("t1", "Twin"), inst("t2", "Twin"), inst("t3", "Twin")];
    expect(targetError(() => resolveTargets(twins, ["Ghost"])).message).toBe(
      'Unknown target "Ghost"',
    );
    expect(targetError(() => resolveTargets(twins, ["Twin"])).message).toBe(
      'Ambiguous target "Twin": 3 instances share that name; use an id',
    );
  });
});

describe("compareByInitiative", () => {
  it("compareByInitiative sorts initiative descending, nulls last, ties by creation order", () => {
    const list = [
      inst("tie-b", "TieB", 10, 5),
      inst("null-b", "NullB", null, 6),
      inst("low", "Low", 3, 2),
      inst("tie-a", "TieA", 10, 4),
      inst("high", "High", 18, 7),
      inst("null-a", "NullA", null, 1),
      inst("neg", "Neg", -1, 3),
    ];
    expect(list.sort(compareByInitiative).map((i) => i.displayName)).toEqual([
      "High",
      "TieA",
      "TieB",
      "Low",
      "Neg",
      "NullA",
      "NullB",
    ]);
  });
});
