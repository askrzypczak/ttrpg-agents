import type { MonsterInstance } from "../encounter/types.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { DifficultyTables } from "./tables.js";

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
  void deps;
  void request;
  throw new Error("not implemented");
}
