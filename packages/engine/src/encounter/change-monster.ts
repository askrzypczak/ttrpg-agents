import type { RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { HpMode, NamingStrategy } from "./add-monsters.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export interface ChangeMonsterTypeDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
  naming?: NamingStrategy;
}

/** One changed instance: as listed before the change and as written. */
export interface ChangedMonster {
  before: MonsterInstance;
  after: MonsterInstance;
  /** True when its footprint grew. */
  noLongerFits: boolean;
}

export interface ChangeMonsterTypeResult {
  /** One per given id, in that order. */
  instances: ChangedMonster[];
  /** One entry per HP roll, in id order; empty in average mode. */
  rolls: RollLogEntry[];
}

/**
 * Changes existing instances to another monster type, keeping each one's id,
 * group, stats visibility, spawn position and damage taken.
 */
export function changeMonsterType(
  deps: ChangeMonsterTypeDeps,
  instanceIds: readonly string[],
  monsterKey: string,
  mode: HpMode,
  origin: ChangeOrigin,
): ChangeMonsterTypeResult {
  void deps;
  void instanceIds;
  void monsterKey;
  void mode;
  void origin;
  throw new Error("not implemented");
}
