import { beforeEach, describe, expect, it } from "vitest";
import {
  AddMonstersError,
  SqliteEncounterRepository,
  MAX_GROUP_COUNT,
  addMonsters,
  createNumberedNaming,
  loadSrdMonsters,
  openDatabase,
  type AddMonstersDeps,
  type AddMonstersErrorCode,
  type AddMonstersGroup,
  type Rng,
} from "../index.js";

const SHADOW = "srd-2024_shadow";
const GOBLIN = "srd-2024_goblin-warrior";
const monsters = loadSrdMonsters();
const shadow = monsters.byKey.get(SHADOW);
const goblin = monsters.byKey.get(GOBLIN);
if (!shadow || !goblin) throw new Error("SRD fixtures missing");

let repo: SqliteEncounterRepository;
let calls: number;
let groupN: number;

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max. */
function cycleRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

function countingRng(...values: number[]): Rng {
  const inner = cycleRng(...values);
  return {
    nextInt(max) {
      calls++;
      return inner.nextInt(max);
    },
  };
}

function deps(over: Partial<AddMonstersDeps> = {}): AddMonstersDeps {
  return {
    repo,
    monsters,
    rng: countingRng(7, 12, 3, 18, 9, 1),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newGroupId: () => `group-${++groupN}`,
    ...over,
  };
}

beforeEach(() => {
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(openDatabase(":memory:"), {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  calls = 0;
  groupN = 0;
});

describe("addMonsters", () => {
  it("adds 5 shadows with rolled HP, numbered names and shared initiative", () => {
    const { instances, rolls } = addMonsters(deps(), [
      { monster: SHADOW, count: 5 },
    ]);
    expect(instances.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
      "Shadow 4",
      "Shadow 5",
    ]);
    for (const i of instances) {
      expect(i.maxHp).toBeGreaterThanOrEqual(10);
      expect(i.maxHp).toBeLessThanOrEqual(45);
      expect(i.hpMode).toBe("rolled");
      expect(i.monsterKey).toBe(SHADOW);
    }
    expect(new Set(instances.map((i) => i.groupId)).size).toBe(1);
    expect(new Set(instances.map((i) => i.initiative)).size).toBe(1);
    // 5 HP rolls + 1 group initiative roll
    expect(rolls).toHaveLength(6);

    const stored = repo.listInstances();
    expect(stored).toHaveLength(5);
    for (const s of stored) expect(s.currentHp).toBe(s.maxHp);
    expect(stored.map((s) => s.maxHp)).toEqual(instances.map((i) => i.maxHp));
  });

  it("continues numbering across calls and never reuses a present number", () => {
    addMonsters(deps(), [{ monster: SHADOW, count: 5 }]);
    const second = addMonsters(deps(), [{ monster: SHADOW, count: 3 }]);
    expect(second.instances.map((i) => i.name)).toEqual([
      "Shadow 6",
      "Shadow 7",
      "Shadow 8",
    ]);
    const first = repo.listInstances()[0];
    if (!first) throw new Error("expected instance");
    repo.removeInstances([first.id]);
    const third = addMonsters(deps(), [{ monster: SHADOW, count: 1 }]);
    expect(third.instances.map((i) => i.name)).toEqual(["Shadow 9"]);
  });

  it("continues numbering for repeated groups of one monster in a call", () => {
    const { instances } = addMonsters(deps(), [
      { monster: SHADOW, count: 2 },
      { monster: SHADOW, count: 2 },
    ]);
    expect(instances.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
      "Shadow 4",
    ]);
    expect(new Set(instances.map((i) => i.groupId)).size).toBe(2);
  });

  it("handles mixed rolled and average groups in one call", () => {
    const { instances, rolls } = addMonsters(deps(), [
      { monster: SHADOW, count: 5 },
      { monster: GOBLIN, count: 2, hp: "average" },
    ]);
    const goblins = instances.filter((i) => i.monsterKey === GOBLIN);
    expect(goblins).toHaveLength(2);
    for (const g of goblins) {
      expect(g.maxHp).toBe(goblin.hp.average);
      expect(g.hpMode).toBe("average");
      expect(g.name).toMatch(/^.+ \d$/);
    }
    const shadows = instances.filter((i) => i.monsterKey === SHADOW);
    expect(shadows[0]?.groupId).not.toBe(goblins[0]?.groupId);
    expect(goblins[0]?.groupId).toBe(goblins[1]?.groupId);
    // shadows: 5 HP + 1 init; goblins: 1 init only
    expect(rolls).toHaveLength(7);
    expect(rolls.filter((r) => r.label?.endsWith(" HP"))).toHaveLength(5);
    expect(
      rolls.filter((r) => r.label?.endsWith(" HP")).map((r) => r.label),
    ).toEqual([1, 2, 3, 4, 5].map((n) => `Shadow ${String(n)} HP`));
    expect(
      instances.filter((i) => i.hpMode === "rolled").map((i) => i.name),
    ).toEqual(["Shadow 1", "Shadow 2", "Shadow 3", "Shadow 4", "Shadow 5"]);
    expect(
      instances.filter((i) => i.hpMode === "average").map((i) => i.monsterKey),
    ).toEqual([GOBLIN, GOBLIN]);
  });

  it("does not consume rng for HP in average mode", () => {
    addMonsters(deps(), [{ monster: SHADOW, count: 4, hp: "average" }]);
    expect(calls).toBe(1); // only the group initiative d20
    expect(repo.listInstances().map((i) => i.maxHp)).toEqual([27, 27, 27, 27]);
  });

  it("rolls initiative per instance in each mode", () => {
    const { instances, rolls } = addMonsters(
      deps(),
      [{ monster: SHADOW, count: 6, hp: "average" }],
      { initiative: "each" },
    );
    expect(rolls).toHaveLength(6);
    expect(calls).toBe(6);
    expect(new Set(instances.map((i) => i.initiative)).size).toBeGreaterThan(1);
    expect(rolls.map((r) => r.label)).toEqual(
      instances.map((i) => `${i.name} initiative`),
    );
  });

  it("computes initiative as d20 plus the monster modifier", () => {
    const { instances, rolls } = addMonsters(deps(), [
      { monster: SHADOW, count: 1, hp: "average" },
      { monster: GOBLIN, count: 1, hp: "average" },
    ]);
    const [s, g] = rolls;
    expect(instances[0]?.initiative).toBe(
      (s?.total ?? 0) + shadow.initiativeModifier,
    );
    expect(instances[1]?.initiative).toBe(
      (g?.total ?? 0) + goblin.initiativeModifier,
    );
    expect(shadow.initiativeModifier).not.toBe(0);
  });

  it("uses a custom naming strategy", () => {
    const seen: string[][] = [];
    const { instances } = addMonsters(
      deps({
        naming: ({ monster, existingNames }) => {
          seen.push([...existingNames]);
          return `${monster.name} #${String(existingNames.length + 1)}`;
        },
      }),
      [{ monster: SHADOW, count: 2, hp: "average" }],
    );
    expect(instances.map((i) => i.name)).toEqual(["Shadow #1", "Shadow #2"]);
    expect(seen).toEqual([[], ["Shadow #1"]]);
  });

  it("returns statblock AC and labelled rolls with sides and totals", () => {
    const { instances, rolls } = addMonsters(deps(), [
      { monster: SHADOW, count: 2 },
    ]);
    for (const i of instances) expect(i.ac).toBe(shadow.ac);
    const hpRolls = rolls.filter((r) => r.label?.endsWith(" HP"));
    expect(hpRolls.map((r) => r.label)).toEqual(["Shadow 1 HP", "Shadow 2 HP"]);
    expect(hpRolls[0]?.sides).toEqual([8]);
    expect(hpRolls.map((r) => r.total)).toEqual(instances.map((i) => i.maxHp));
    const init = rolls.at(-1);
    expect(init?.label).toBe("Shadow initiative (group)");
    expect(init?.sides).toEqual([20]);
    expect(init?.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clamps rolled HP to 1 but logs the raw total", () => {
    const weak = {
      ...shadow,
      key: "test_weak",
      name: "Weakling",
      hp: { ...shadow.hp, dice: "1d4-5", average: 1 },
    };
    const index = {
      monsters: [weak],
      byKey: new Map([[weak.key, weak]]),
    };
    const rng: Rng = { nextInt: () => 0 }; // every die shows its minimum (1)
    const { instances, rolls } = addMonsters(deps({ monsters: index, rng }), [
      { monster: weak.key, count: 1 },
    ]);
    expect(instances[0]?.maxHp).toBe(1);
    expect(repo.listInstances()[0]?.maxHp).toBe(1);
    expect(rolls[0]?.label).toBe("Weakling 1 HP");
    expect(rolls[0]?.total).toBe(-4);
  });

  it("falls back to a random UUID group id by default", () => {
    const { instances } = addMonsters({ ...deps(), newGroupId: undefined }, [
      { monster: SHADOW, count: 1 },
    ]);
    expect(instances[0]?.groupId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("addMonsters validation", () => {
  const cases: [string, AddMonstersGroup[], AddMonstersErrorCode][] = [
    ["empty list", [], "empty"],
    [
      "unknown monster in a later group",
      [
        { monster: SHADOW, count: 2 },
        { monster: "nope", count: 1 },
      ],
      "unknown_monster",
    ],
    ["count 0", [{ monster: SHADOW, count: 0 }], "invalid_count"],
    [
      "bad initiative mode",
      [{ monster: SHADOW, count: 1 }],
      "invalid_initiative",
    ],
    ["count 51", [{ monster: SHADOW, count: 51 }], "invalid_count"],
    ["negative count", [{ monster: SHADOW, count: -1 }], "invalid_count"],
    ["fractional count", [{ monster: SHADOW, count: 1.5 }], "invalid_count"],
    ["NaN count", [{ monster: SHADOW, count: NaN }], "invalid_count"],
    [
      "bad hp mode",
      [{ monster: SHADOW, count: 1, hp: "max" as "rolled" }],
      "invalid_hp",
    ],
  ];

  it.each(cases)(
    "%s throws and leaves the store and rng untouched",
    (_n, groups, code) => {
      let error: unknown;
      try {
        addMonsters(
          deps(),
          groups,
          code === "invalid_initiative"
            ? { initiative: "Each" as "each" }
            : undefined,
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AddMonstersError);
      expect((error as AddMonstersError).code).toBe(code);
      expect(repo.listInstances()).toEqual([]);
      expect(calls).toBe(0);
    },
  );

  it("accepts the maximum count of 50", () => {
    const { instances } = addMonsters(deps(), [
      { monster: SHADOW, count: 50, hp: "average" },
    ]);
    expect(instances).toHaveLength(50);
  });

  it("rejects a count above the default cap but allows a higher one", () => {
    expect(MAX_GROUP_COUNT).toBe(50);
    expect(() =>
      addMonsters(deps(), [{ monster: SHADOW, count: 51, hp: "average" }]),
    ).toThrow(/between 1 and 50/);
    const { instances } = addMonsters(
      deps(),
      [{ monster: SHADOW, count: 200, hp: "average" }],
      { maxGroupCount: 200 },
    );
    expect(instances).toHaveLength(200);
    expect(() =>
      addMonsters(deps(), [{ monster: SHADOW, count: 11 }], {
        maxGroupCount: 10,
      }),
    ).toThrow(/between 1 and 10/);
  });

  it.each([0, -1, 1.5, NaN])("rejects maxGroupCount %s", (max) => {
    expect(() =>
      addMonsters(deps(), [{ monster: SHADOW, count: 1 }], {
        maxGroupCount: max,
      }),
    ).toThrow(AddMonstersError);
    expect(repo.listInstances()).toEqual([]);
    expect(calls).toBe(0);
  });

  it("names the offending group in the message", () => {
    expect(() =>
      addMonsters(deps(), [
        { monster: SHADOW, count: 1 },
        { monster: "nope", count: 1 },
      ]),
    ).toThrow(/Group 2 \(nope\)/);
  });
});

describe("createNumberedNaming", () => {
  const named = (name: string) => ({ ...goblin, name });

  it("continues from the highest suffix and across repeated calls", () => {
    const naming = createNumberedNaming();
    const existing = ["Goblin 2", "Goblin 7", "Goblin 3"];
    expect(naming({ monster: goblin, existingNames: existing })).toBe(
      `${goblin.name} 1`,
    );
    const m = named("Goblin");
    const n2 = createNumberedNaming();
    expect(n2({ monster: m, existingNames: existing })).toBe("Goblin 8");
    expect(n2({ monster: m, existingNames: existing })).toBe("Goblin 9");
    expect(n2({ monster: m, existingNames: [] })).toBe("Goblin 10");
  });

  it("ignores other monsters' suffixes and shared prefixes", () => {
    const naming = createNumberedNaming();
    const existing = ["Goblin Warrior 3", "Goblin Warrior 4", "Goblin 1"];
    expect(naming({ monster: named("Goblin"), existingNames: existing })).toBe(
      "Goblin 2",
    );
    expect(
      naming({ monster: named("Goblin Warrior"), existingNames: existing }),
    ).toBe("Goblin Warrior 5");
    expect(
      naming({ monster: named("Goblin War"), existingNames: existing }),
    ).toBe("Goblin War 1");
  });

  it("treats regex characters literally and ignores non-numeric suffixes", () => {
    const naming = createNumberedNaming();
    const existing = ["A.B 4", "AxB 9", "(Boss)* 2", "Goblin x", "Goblin", "7"];
    expect(naming({ monster: named("A.B"), existingNames: existing })).toBe(
      "A.B 5",
    );
    expect(naming({ monster: named("(Boss)*"), existingNames: existing })).toBe(
      "(Boss)* 3",
    );
    expect(naming({ monster: named("Goblin"), existingNames: existing })).toBe(
      "Goblin 1",
    );
  });

  it("keeps numbering distinct monsters independent within one call", () => {
    const { instances } = addMonsters(deps(), [
      { monster: SHADOW, count: 2, hp: "average" },
      { monster: GOBLIN, count: 1, hp: "average" },
      { monster: SHADOW, count: 1, hp: "average" },
    ]);
    expect(instances.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      `${goblin.name} 1`,
      "Shadow 3",
    ]);
  });
});
