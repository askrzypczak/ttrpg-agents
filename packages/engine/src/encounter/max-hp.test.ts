import { describe, expect, it } from "vitest";
import type { Rng } from "../dice/rng.js";
import { makeTestInstance, makeTestMonsterIndex } from "../testing/index.js";
import { UnknownMonsterError } from "./errors.js";
import { resetMaxHp, rollMaxHp, type MaxHpRollDeps } from "./max-hp.js";
import type { EncounterRepository } from "./repository.js";

const NOW = "2026-01-01T00:00:00.000Z";

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max; counts calls. */
function cycleRng(...values: number[]): Rng & { calls: number } {
  let i = 0;
  const rng = {
    calls: 0,
    nextInt(max: number) {
      rng.calls++;
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
  return rng;
}

function deps(rng: Rng): MaxHpRollDeps {
  return { rng, now: () => new Date(NOW) };
}

describe("rollMaxHp", () => {
  it("rollMaxHp in average mode returns the average and consumes no rng", () => {
    const rng = cycleRng(5);

    const result = rollMaxHp(
      deps(rng),
      { average: 11, dice: "2d8+2" },
      "average",
      "Wolf 1",
    );

    expect(result).toEqual({ maxHp: 11, roll: null });
    expect(rng.calls).toBe(0);
  });

  it('rollMaxHp in rolled mode returns the total of the HP dice rolled with the injected rng and logs the roll labelled "<name> HP"', () => {
    // Each die shows the rng value plus one: 3 + 6 + 2.
    const rng = cycleRng(2, 5);

    const result = rollMaxHp(
      deps(rng),
      { average: 11, dice: "2d8+2" },
      "rolled",
      "Wolf 2",
    );

    expect(result.maxHp).toBe(11);
    expect(result.roll).toMatchObject({
      expression: "2d8+2",
      dice: [[3, 6]],
      total: 11,
      label: "Wolf 2 HP",
      timestamp: NOW,
    });
    expect(rng.calls).toBe(2);
  });

  it("rollMaxHp raises a rolled total below 1 to 1 and logs the raw total", () => {
    // 1 + 1 - 5 = -3.
    const rng = cycleRng(0);

    const result = rollMaxHp(
      deps(rng),
      { average: 0, dice: "2d4-5" },
      "rolled",
      "Rat 1",
    );

    expect(result.maxHp).toBe(1);
    expect(result.roll).toMatchObject({
      expression: "2d4-5",
      total: -3,
      label: "Rat 1 HP",
    });
  });
});

describe("resetMaxHp", () => {
  it("resetMaxHp for an instance whose stored creature is quarantined throws UnknownMonsterError naming the quarantine reason", () => {
    const quarantine = {
      key: "homebrew_thornling",
      message:
        'Stored creature "homebrew_thornling" is quarantined: its statblock\'s key is "homebrew_bramble"',
    };
    const monsters = {
      ...makeTestMonsterIndex([]),
      quarantined: () => [quarantine],
    };
    const thornling = makeTestInstance({
      id: "t1",
      monsterKey: "homebrew_thornling",
      displayName: "Thornling 1",
    });
    const repo = {
      listInstances: () => [thornling],
    } as unknown as EncounterRepository;

    let error: unknown;
    try {
      resetMaxHp(
        { repo, monsters, rng: cycleRng(0), now: () => new Date(NOW) },
        ["t1"],
        "average",
        { source: "mcp", commandId: "c1" },
      );
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(UnknownMonsterError);
    expect((error as UnknownMonsterError).code).toBe("unknown_monster");
    expect((error as UnknownMonsterError).message).toContain(
      quarantine.message,
    );
  });
});
