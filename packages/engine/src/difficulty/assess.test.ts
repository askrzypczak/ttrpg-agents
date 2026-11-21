import { describe, expect, it } from "vitest";
import { UnknownMonsterError } from "../encounter/errors.js";
import type { MonsterInstance } from "../encounter/types.js";
import type { Monster } from "../monsters/schema.js";
import {
  makeTestInstance,
  makeTestMonster,
  makeTestMonsterIndex,
} from "../testing/index.js";
import {
  assessDifficulty,
  type AssessDifficultyRequest,
  type DifficultyAssessment,
} from "./assess.js";
import { InvalidCountError } from "./errors.js";
import type { DifficultyTables } from "./tables.js";

// CR 0 is worth 1 XP, so one more monster lands a total one XP above a budget.
const TABLES: DifficultyTables = {
  xpByCr: [
    { cr: 0, xp: 1 },
    { cr: 1, xp: 100 },
    { cr: 2, xp: 200 },
    { cr: 3, xp: 300 },
  ],
  budgetPerCharacter: [
    { level: 1, low: 100, moderate: 200, high: 300 },
    { level: 3, low: 150, moderate: 225, high: 400 },
  ],
};

const SOLO = { size: 1, level: 1 };

const mite = makeTestMonster({
  key: "mite",
  name: "Mite",
  cr: 0,
  hp: { average: 3, dice: "1d6" },
});
const grunt = makeTestMonster({
  key: "grunt",
  name: "Grunt",
  cr: 1,
  hp: { average: 10, dice: "3d6" },
});
const brute = makeTestMonster({
  key: "brute",
  name: "Brute",
  cr: 2,
  hp: { average: 20, dice: "4d8 + 2" },
});
const chief = makeTestMonster({
  key: "chief",
  name: "Chief",
  cr: 3,
  hp: { average: 30, dice: "5d10 + 3" },
});
// CR 1/4 is not in TABLES.
const oddling = makeTestMonster({
  key: "oddling",
  name: "Oddling",
  cr: 0.25,
  hp: { average: 6, dice: "2d4 + 1" },
});

function entry(name: string): Monster["sections"]["traits"][number] {
  return { name, desc: `${name} text.` };
}

function sections(
  overrides: Partial<Monster["sections"]>,
): Monster["sections"] {
  return {
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    ...overrides,
  };
}

let nextId = 0;

/** `count` instances of `monster`, named "<Name> 1", "<Name> 2", ... */
function instancesOf(
  monster: Pick<Monster, "key" | "name">,
  count: number,
  overrides: Partial<MonsterInstance> = {},
): MonsterInstance[] {
  return Array.from({ length: count }, (_, i) => {
    nextId += 1;
    return makeTestInstance({
      id: `i${nextId}`,
      monsterKey: monster.key,
      displayName: `${monster.name} ${i + 1}`,
      maxHp: 10,
      currentHp: 10,
      ...overrides,
    });
  });
}

function assess(
  request: Partial<AssessDifficultyRequest>,
  monsters: readonly Monster[] = [mite, grunt, brute, chief, oddling],
): DifficultyAssessment {
  return assessDifficulty(
    { tables: TABLES, monsters: makeTestMonsterIndex(monsters) },
    { instances: [], party: SOLO, ...request },
  );
}

describe("assessDifficulty bands", () => {
  it("assessDifficulty places a total exactly at the Low budget in low and one XP above it in moderate", () => {
    const at = assess({ instances: instancesOf(grunt, 1) });
    expect(at.totals.xp).toBe(100);
    expect(at.band).toBe("low");

    const above = assess({
      instances: [...instancesOf(grunt, 1), ...instancesOf(mite, 1)],
    });
    expect(above.totals.xp).toBe(101);
    expect(above.band).toBe("moderate");
  });

  it("assessDifficulty places a total exactly at the Moderate budget in moderate and one XP above it in high", () => {
    const at = assess({ instances: instancesOf(brute, 1) });
    expect(at.totals.xp).toBe(200);
    expect(at.band).toBe("moderate");

    const above = assess({
      instances: [...instancesOf(brute, 1), ...instancesOf(mite, 1)],
    });
    expect(above.totals.xp).toBe(201);
    expect(above.band).toBe("high");
  });

  it("assessDifficulty places a total exactly at the High budget in high and one XP above it in above-high", () => {
    const at = assess({ instances: instancesOf(chief, 1) });
    expect(at.totals.xp).toBe(300);
    expect(at.band).toBe("high");

    const above = assess({
      instances: [...instancesOf(chief, 1), ...instancesOf(mite, 1)],
    });
    expect(above.totals.xp).toBe(301);
    expect(above.band).toBe("above-high");
  });

  it("assessDifficulty reports each budget as the level's per-character value times the party size", () => {
    const result = assess({
      instances: instancesOf(grunt, 1),
      party: { size: 4, level: 3 },
    });

    expect(result.party).toEqual({
      size: 4,
      level: 3,
      budgets: { low: 600, moderate: 900, high: 1600 },
    });
  });
});

describe("assessDifficulty hypothetical monsters", () => {
  it("assessDifficulty counts hypothetical monsters apart from the encounter's instances of the same type", () => {
    const result = assess({
      instances: instancesOf(grunt, 2),
      hypothetical: [{ monsterKey: "grunt", count: 3 }],
    });

    expect(result.monsters).toHaveLength(1);
    expect(result.monsters[0]).toMatchObject({
      monsterKey: "grunt",
      encounterCount: 2,
      hypotheticalCount: 3,
      xpEach: 100,
      xpTotal: 500,
    });
    expect(result.totals.monsterCount).toBe(5);
  });

  it("assessDifficulty adds hypothetical monsters to the totals and the band", () => {
    const instances = instancesOf(grunt, 1);
    const without = assess({ instances });
    expect(without.totals.xp).toBe(100);
    expect(without.band).toBe("low");

    const result = assess({
      instances,
      hypothetical: [{ monsterKey: "mite", count: 1 }],
    });

    expect(result.totals.xp).toBe(101);
    expect(result.totals.monsterCount).toBe(2);
    expect(result.band).toBe("moderate");
  });

  it("assessDifficulty merges hypothetical groups of one monster into one type", () => {
    const result = assess({
      hypothetical: [
        { monsterKey: "grunt", count: 1 },
        { monsterKey: "mite", count: 2 },
        { monsterKey: "grunt", count: 2 },
      ],
    });

    expect(
      result.monsters.map((m) => [
        m.monsterKey,
        m.encounterCount,
        m.hypotheticalCount,
        m.xpTotal,
      ]),
    ).toEqual([
      ["grunt", 0, 3, 300],
      ["mite", 0, 2, 2],
    ]);
  });

  it("assessDifficulty leaves the instances it is given unchanged", () => {
    const instances = [
      ...instancesOf(grunt, 2, { currentHp: 0 }),
      ...instancesOf(mite, 1),
      ...instancesOf({ key: "ghost", name: "Ghost" }, 1),
    ];
    const before = structuredClone(instances);

    const result = assess({
      instances,
      hypothetical: [{ monsterKey: "grunt", count: 2 }],
    });

    expect(result.totals.monsterCount).toBe(6);
    expect(instances).toEqual(before);
  });
});

describe("assessDifficulty problems", () => {
  it("assessDifficulty excludes an instance whose monster is unknown from XP and lists it as a problem with its display name", () => {
    const result = assess({
      instances: [
        ...instancesOf(grunt, 1),
        ...instancesOf({ key: "ghost", name: "Ghost" }, 2),
      ],
    });

    expect(result.totals.xp).toBe(100);
    expect(result.monsters.map((m) => m.monsterKey)).toEqual(["grunt"]);
    expect(result.problems).toEqual([
      {
        kind: "unknown-monster",
        monsterKey: "ghost",
        instances: ["Ghost 1", "Ghost 2"],
      },
    ]);
  });

  it("assessDifficulty excludes a monster whose CR the table lacks from XP and lists it as a problem with its CR", () => {
    const result = assess({
      instances: [...instancesOf(grunt, 1), ...instancesOf(oddling, 1)],
      hypothetical: [{ monsterKey: "oddling", count: 2 }],
    });

    expect(result.totals.xp).toBe(100);
    expect(result.monsters.map((m) => m.monsterKey)).toEqual(["grunt"]);
    expect(result.problems).toEqual([
      {
        kind: "cr-not-in-table",
        monsterKey: "oddling",
        name: "Oddling",
        cr: 0.25,
        encounterCount: 1,
        hypotheticalCount: 2,
      },
    ]);
  });

  it("assessDifficulty counts problem instances in the monster count and HP totals", () => {
    const result = assess({
      instances: [
        ...instancesOf(grunt, 1, { currentHp: 10, maxHp: 10 }),
        ...instancesOf({ key: "ghost", name: "Ghost" }, 1, {
          currentHp: 15,
          maxHp: 20,
        }),
        ...instancesOf(oddling, 1, { currentHp: 4, maxHp: 8 }),
      ],
      hypothetical: [{ monsterKey: "oddling", count: 1 }],
    });

    expect(result.totals.xp).toBe(100);
    expect(result.totals.monsterCount).toBe(4);
    expect(result.totals.currentHp).toBe(35);
    expect(result.totals.maxHp).toBe(44);
  });
});

describe("assessDifficulty crowding", () => {
  it("assessDifficulty sets the crowding flag at more than two monsters per character", () => {
    const result = assess({
      instances: instancesOf(mite, 5),
      party: { size: 2, level: 1 },
    });

    expect(result.crowding).toEqual({
      monstersPerCharacter: 2.5,
      moreThanTwoPerCharacter: true,
    });
  });

  it("assessDifficulty does not set the crowding flag at exactly two monsters per character", () => {
    const result = assess({
      instances: instancesOf(mite, 3),
      hypothetical: [{ monsterKey: "mite", count: 1 }],
      party: { size: 2, level: 1 },
    });

    expect(result.crowding).toEqual({
      monstersPerCharacter: 2,
      moreThanTwoPerCharacter: false,
    });
  });
});

describe("assessDifficulty facts", () => {
  it('assessDifficulty reports Multiattack for a monster with an action named "Multiattack" and not for one without', () => {
    const striker = makeTestMonster({
      key: "striker",
      name: "Striker",
      cr: 1,
      sections: sections({
        actions: [entry("Multiattack"), entry("Claw")],
      }),
    });
    const plain = makeTestMonster({
      key: "plain",
      name: "Plain",
      cr: 1,
      sections: sections({ actions: [entry("Claw")] }),
    });

    const result = assess(
      { instances: [...instancesOf(striker, 1), ...instancesOf(plain, 1)] },
      [striker, plain],
    );

    expect(result.monsters.map((m) => [m.monsterKey, m.multiattack])).toEqual([
      ["striker", true],
      ["plain", false],
    ]);
  });

  it("assessDifficulty reports legendary actions for a monster with a legendary action and not for one without", () => {
    const legend = makeTestMonster({
      key: "legend",
      name: "Legend",
      cr: 1,
      sections: sections({
        legendaryActions: [{ name: "Tail", desc: "Tail text.", cost: 1 }],
      }),
    });
    const plain = makeTestMonster({ key: "plain", name: "Plain", cr: 1 });

    const result = assess(
      { instances: [...instancesOf(legend, 1), ...instancesOf(plain, 1)] },
      [legend, plain],
    );

    expect(
      result.monsters.map((m) => [m.monsterKey, m.legendaryActions]),
    ).toEqual([
      ["legend", true],
      ["plain", false],
    ]);
  });

  it('assessDifficulty reports a lair variant for a monster with an entry whose name contains "in Lair" in any case, and not for one without', () => {
    const wyrm = makeTestMonster({
      key: "wyrm",
      name: "Wyrm",
      cr: 1,
      sections: sections({
        traits: [entry("Legendary Resistance (3/Day, or 4/Day in Lair)")],
      }),
    });
    const lurker = makeTestMonster({
      key: "lurker",
      name: "Lurker",
      cr: 1,
      sections: sections({ reactions: [entry("Strike IN LAIR")] }),
    });
    const wanderer = makeTestMonster({
      key: "wanderer",
      name: "Wanderer",
      cr: 1,
      sections: sections({
        traits: [{ name: "Homebody", desc: "Stronger when in lair." }],
      }),
    });

    const result = assess(
      {
        instances: [
          ...instancesOf(wyrm, 1),
          ...instancesOf(lurker, 1),
          ...instancesOf(wanderer, 1),
        ],
      },
      [wyrm, lurker, wanderer],
    );

    expect(result.monsters.map((m) => [m.monsterKey, m.lairVariant])).toEqual([
      ["wyrm", true],
      ["lurker", true],
      ["wanderer", false],
    ]);
  });
});

describe("assessDifficulty per-type and HP totals", () => {
  it("assessDifficulty reports per monster type the encounter count, hypothetical count, XP each and XP total", () => {
    const result = assess({
      instances: [
        ...instancesOf(mite, 1),
        ...instancesOf(grunt, 2),
        ...instancesOf(mite, 1),
      ],
      hypothetical: [
        { monsterKey: "brute", count: 1 },
        { monsterKey: "mite", count: 2 },
      ],
    });

    const facts = {
      multiattack: false,
      legendaryActions: false,
      lairVariant: false,
    };
    expect(result.monsters).toEqual([
      {
        monsterKey: "mite",
        name: "Mite",
        cr: 0,
        encounterCount: 2,
        hypotheticalCount: 2,
        xpEach: 1,
        xpTotal: 4,
        ...facts,
      },
      {
        monsterKey: "grunt",
        name: "Grunt",
        cr: 1,
        encounterCount: 2,
        hypotheticalCount: 0,
        xpEach: 100,
        xpTotal: 200,
        ...facts,
      },
      {
        monsterKey: "brute",
        name: "Brute",
        cr: 2,
        encounterCount: 0,
        hypotheticalCount: 1,
        xpEach: 200,
        xpTotal: 200,
        ...facts,
      },
    ]);
    expect(result.totals.xp).toBe(404);
    expect(result.totals.monsterCount).toBe(7);
    expect(result.problems).toEqual([]);
  });

  it("assessDifficulty totals current and max HP over the instances and adds each hypothetical monster at its average HP", () => {
    const result = assess({
      instances: [
        ...instancesOf(grunt, 1, { currentHp: 4, maxHp: 10 }),
        ...instancesOf(grunt, 1, { currentHp: 10, maxHp: 12 }),
      ],
      hypothetical: [{ monsterKey: "mite", count: 2 }],
    });

    expect(result.totals.currentHp).toBe(4 + 10 + 2 * 3);
    expect(result.totals.maxHp).toBe(10 + 12 + 2 * 3);
  });

  it("assessDifficulty counts the instances at 0 HP and still counts their XP", () => {
    const result = assess({
      instances: [
        ...instancesOf(grunt, 2, { currentHp: 0 }),
        ...instancesOf(grunt, 1, { currentHp: 5 }),
      ],
    });

    expect(result.totals.atZeroHp).toBe(2);
    expect(result.totals.xp).toBe(300);
    expect(result.monsters[0]).toMatchObject({
      encounterCount: 3,
      xpTotal: 300,
    });
  });
});

describe("assessDifficulty lair XP", () => {
  it("assessDifficulty with inLair counts the next row's XP for a monster with a lair variant and the plain XP for others", () => {
    const wyrm = makeTestMonster({
      key: "wyrm",
      name: "Wyrm",
      cr: 1,
      sections: sections({
        traits: [entry("Legendary Resistance (3/Day, or 4/Day in Lair)")],
      }),
    });
    const request = {
      instances: [...instancesOf(wyrm, 1), ...instancesOf(grunt, 1)],
    };

    const lair = assess({ ...request, inLair: true }, [wyrm, grunt]);
    expect(lair.monsters.map((m) => [m.monsterKey, m.xpEach])).toEqual([
      ["wyrm", 200],
      ["grunt", 100],
    ]);
    expect(lair.totals.xp).toBe(300);

    const away = assess(request, [wyrm, grunt]);
    expect(away.monsters.map((m) => [m.monsterKey, m.xpEach])).toEqual([
      ["wyrm", 100],
      ["grunt", 100],
    ]);
    expect(away.totals.xp).toBe(200);
  });
});

describe("assessDifficulty errors", () => {
  it("assessDifficulty fails with UnknownMonsterError naming every unknown hypothetical key", () => {
    let caught: unknown;
    try {
      assess({
        instances: instancesOf(grunt, 1),
        hypothetical: [
          { monsterKey: "ghost", count: 1 },
          { monsterKey: "grunt", count: 0 },
          { monsterKey: "wraith", count: 2 },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnknownMonsterError);
    expect((caught as UnknownMonsterError).code).toBe("unknown_monster");
    expect((caught as Error).message).toContain("ghost");
    expect((caught as Error).message).toContain("wraith");
  });

  it("assessDifficulty fails with InvalidCountError for a hypothetical count of 0, a negative count or a fraction", () => {
    for (const count of [0, -1, 1.5]) {
      let caught: unknown;
      try {
        assess({
          instances: instancesOf(grunt, 1),
          hypothetical: [
            { monsterKey: "mite", count: 1 },
            { monsterKey: "grunt", count },
          ],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(InvalidCountError);
      expect((caught as InvalidCountError).code).toBe("invalid_count");
      expect((caught as Error).message).toContain("grunt");
    }
  });
});
