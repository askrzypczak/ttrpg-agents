import { DomainError } from "../errors.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { NamingStrategy } from "./add-monsters.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export type RestoreMonstersErrorCode = "not_removed" | "unknown_monster";

export class RestoreMonstersError extends DomainError {
  declare readonly code: RestoreMonstersErrorCode;
  constructor(code: RestoreMonstersErrorCode, message: string) {
    super(code, message);
    this.name = "RestoreMonstersError";
  }
}

export interface RestoreMonstersDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  /** Names a restored monster whose name is taken; defaults to createNumberedNaming(). */
  naming?: NamingStrategy;
}

export interface RestoredMonster {
  instance: MonsterInstance;
  /** The name it had when removed, when it came back under a new one; else null. */
  renamedFrom: string | null;
}

/** Restores removed monsters by id or exact name, all or nothing. */
export function restoreMonsters(
  deps: RestoreMonstersDeps,
  targets: readonly string[],
  origin: ChangeOrigin,
): RestoredMonster[] {
  void deps;
  void targets;
  void origin;
  throw new Error("not implemented");
}
