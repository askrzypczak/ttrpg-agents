import { UnknownMonsterError } from "../encounter/errors.js";
import type { MonsterInstance } from "../encounter/types.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { InvalidCountError } from "./errors.js";
import { xpForCr, type DifficultyTables } from "./tables.js";

export type DifficultyBand = "low" | "moderate" | "high" | "above-high";

export interface HypotheticalMonsters {
  monsterKey: string;
  /** An integer of 1 or more; checked, InvalidCountError otherwise. */
  count: number;
}

export interface AssessDifficultyDeps {
  tables: DifficultyTables;
  monsters: Pick<MonsterIndex, "get">;
}

export interface AssessDifficultyRequest {
  /** The encounter's instances; [] for hypothetical monsters alone. Not modified. */
  instances: readonly MonsterInstance[];
  /** Counted without being stored; groups of one key merge. Default none. */
  hypothetical?: readonly HypotheticalMonsters[];
  /** Already valid: size an integer of 1 or more, level 1 to 20. */
  party: { readonly size: number; readonly level: number };
  /** Count each monster with a lair variant at the next CR row's XP. Default false. */
  inLair?: boolean;
}

/** One monster type whose XP is known. */
export interface DifficultyMonsterType {
  monsterKey: string;
  name: string;
  cr: number;
  encounterCount: number;
  hypotheticalCount: number;
  xpEach: number;
  xpTotal: number;
  multiattack: boolean;
  legendaryActions: boolean;
  lairVariant: boolean;
}

export type DifficultyProblem =
  | {
      kind: "unknown-monster";
      monsterKey: string;
      /** display names */
      instances: string[];
    }
  | {
      kind: "cr-not-in-table";
      monsterKey: string;
      name: string;
      cr: number;
      encounterCount: number;
      hypotheticalCount: number;
    };

export interface DifficultyAssessment {
  /** First-seen order: the instances' keys, then the hypothetical groups'. */
  monsters: DifficultyMonsterType[];
  totals: {
    monsterCount: number;
    xp: number;
    currentHp: number;
    maxHp: number;
    atZeroHp: number;
  };
  party: {
    size: number;
    level: number;
    budgets: { low: number; moderate: number; high: number };
  };
  band: DifficultyBand;
  crowding: { monstersPerCharacter: number; moreThanTwoPerCharacter: boolean };
  problems: DifficultyProblem[];
}

/** Throws UnknownMonsterError naming every unknown hypothetical key. */
export function assessDifficulty(
  deps: AssessDifficultyDeps,
  request: AssessDifficultyRequest,
): DifficultyAssessment {
  const hypothetical = request.hypothetical ?? [];
  const inLair = request.inLair ?? false;
  const { size, level } = request.party;

  const unknown = [
    ...new Set(
      hypothetical
        .map((group) => group.monsterKey)
        .filter((key) => deps.monsters.get(key) === undefined),
    ),
  ];
  if (unknown.length > 0) {
    throw new UnknownMonsterError(
      `unknown monster${unknown.length === 1 ? "" : "s"} ${unknown
        .map((key) => `"${key}"`)
        .join(", ")}`,
    );
  }
  for (const group of hypothetical) {
    if (!Number.isInteger(group.count) || group.count < 1) {
      throw new InvalidCountError(
        `count for "${group.monsterKey}" must be an integer of 1 or more, got ${group.count}`,
      );
    }
  }

  const budgetRow = deps.tables.budgetPerCharacter.find(
    (row) => row.level === level,
  );
  if (budgetRow === undefined) {
    throw new Error(`difficulty tables have no budget row for level ${level}`);
  }

  // Group by key in first-seen order: instances first, then hypothetical groups.
  const groups = new Map<
    string,
    { instances: MonsterInstance[]; hypotheticalCount: number }
  >();
  const groupOf = (key: string) => {
    let group = groups.get(key);
    if (group === undefined) {
      group = { instances: [], hypotheticalCount: 0 };
      groups.set(key, group);
    }
    return group;
  };
  for (const instance of request.instances) {
    groupOf(instance.monsterKey).instances.push(instance);
  }
  for (const h of hypothetical) {
    groupOf(h.monsterKey).hypotheticalCount += h.count;
  }

  const monsters: DifficultyMonsterType[] = [];
  const problems: DifficultyProblem[] = [];
  let xp = 0;
  let hypotheticalHp = 0;
  for (const [monsterKey, group] of groups) {
    const encounterCount = group.instances.length;
    const { hypotheticalCount } = group;
    const monster = deps.monsters.get(monsterKey);
    if (monster === undefined) {
      problems.push({
        kind: "unknown-monster",
        monsterKey,
        instances: group.instances.map((instance) => instance.displayName),
      });
      continue;
    }
    hypotheticalHp += hypotheticalCount * monster.hp.average;
    const facts = factsOf(monster);
    const xpEach = xpForCr(deps.tables, monster.cr, {
      inLair: inLair && facts.lairVariant,
    });
    if (xpEach === undefined) {
      problems.push({
        kind: "cr-not-in-table",
        monsterKey,
        name: monster.name,
        cr: monster.cr,
        encounterCount,
        hypotheticalCount,
      });
      continue;
    }
    const xpTotal = xpEach * (encounterCount + hypotheticalCount);
    xp += xpTotal;
    monsters.push({
      monsterKey,
      name: monster.name,
      cr: monster.cr,
      encounterCount,
      hypotheticalCount,
      xpEach,
      xpTotal,
      ...facts,
    });
  }

  const monsterCount =
    request.instances.length +
    hypothetical.reduce((sum, group) => sum + group.count, 0);
  const sumOf = (pick: (instance: MonsterInstance) => number) =>
    request.instances.reduce((sum, instance) => sum + pick(instance), 0);

  const budgets = {
    low: budgetRow.low * size,
    moderate: budgetRow.moderate * size,
    high: budgetRow.high * size,
  };
  const band: DifficultyBand =
    xp <= budgets.low
      ? "low"
      : xp <= budgets.moderate
        ? "moderate"
        : xp <= budgets.high
          ? "high"
          : "above-high";

  return {
    monsters,
    totals: {
      monsterCount,
      xp,
      currentHp: sumOf((instance) => instance.currentHp) + hypotheticalHp,
      maxHp: sumOf((instance) => instance.maxHp) + hypotheticalHp,
      atZeroHp: request.instances.filter((instance) => instance.currentHp <= 0)
        .length,
    },
    party: { size, level, budgets },
    band,
    crowding: {
      monstersPerCharacter: monsterCount / size,
      moreThanTwoPerCharacter: monsterCount > 2 * size,
    },
    problems,
  };
}

/** The countable statblock facts, entry names compared ignoring case. */
function factsOf(
  monster: Monster,
): Pick<
  DifficultyMonsterType,
  "multiattack" | "legendaryActions" | "lairVariant"
> {
  const { traits, actions, bonusActions, reactions, legendaryActions } =
    monster.sections;
  return {
    multiattack: actions.some(
      (entry) => entry.name.toLowerCase() === "multiattack",
    ),
    legendaryActions: legendaryActions.length > 0,
    lairVariant: [
      ...traits,
      ...actions,
      ...bonusActions,
      ...reactions,
      ...legendaryActions,
    ].some((entry) => entry.name.toLowerCase().includes("in lair")),
  };
}
