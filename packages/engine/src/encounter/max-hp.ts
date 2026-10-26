import type { RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { HpMode } from "./add-monsters.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, HpChange } from "./repository.js";

export interface MaxHpRollDeps {
  rng: Rng;
  now: () => Date;
}

/** One instance's max HP choice. */
export interface MaxHpRoll {
  /** The average, or the roll's total raised to at least 1. */
  maxHp: number;
  /** The HP dice roll labelled "<displayName> HP", with the raw total; null in average mode. */
  roll: RollLogEntry | null;
}

export function rollMaxHp(
  deps: MaxHpRollDeps,
  hp: Monster["hp"],
  mode: HpMode,
  displayName: string,
): MaxHpRoll {
  void deps;
  void hp;
  void mode;
  void displayName;
  throw new Error("not implemented");
}

export interface ResetMaxHpDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

export interface ResetMaxHpResult {
  /**
   * One per given id, in that order: `before` is the instance before the
   * setMaxHp write, `after` the instance after the last write (the setHp
   * result when one was made).
   */
  instances: HpChange[];
  /** One entry per HP roll, in id order; empty in average mode. */
  rolls: RollLogEntry[];
}

export function resetMaxHp(
  deps: ResetMaxHpDeps,
  instanceIds: readonly string[],
  mode: HpMode,
  origin: ChangeOrigin,
): ResetMaxHpResult {
  void deps;
  void instanceIds;
  void mode;
  void origin;
  throw new Error("not implemented");
}
