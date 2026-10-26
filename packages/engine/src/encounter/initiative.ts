import type { RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { InitiativeMode } from "./add-monsters.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

/** What the roll needs from an instance, stored or about to be added. */
export interface InitiativeRollInput {
  monsterKey: string;
  displayName: string;
  /** Items with the same non-null groupId share one roll in group mode; null or absent rolls alone. */
  groupId?: string | null;
}

export interface InitiativeRollDeps {
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

/** One item's rolled initiative. */
export interface InitiativeRollOutcome {
  /** The d20 result. */
  roll: number;
  /** The monster's initiative modifier that was added. */
  modifier: number;
  /** roll + modifier. */
  initiative: number;
}

export interface InitiativeRollResult {
  /** One per input item, in input order. */
  outcomes: InitiativeRollOutcome[];
  /** One entry per d20 rolled, in roll order. */
  rolls: RollLogEntry[];
}

export function rollInitiativeValues(
  deps: InitiativeRollDeps,
  instances: readonly InitiativeRollInput[],
  mode: InitiativeMode,
): InitiativeRollResult {
  void deps;
  void instances;
  void mode;
  throw new Error("not implemented");
}

export interface RollInitiativeDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

/** One instance after its roll was written. */
export interface RolledInitiative {
  instance: MonsterInstance;
  /** Initiative before the roll; null when it had none. */
  before: number | null;
  roll: number;
  modifier: number;
}

export interface RollInitiativeResult {
  /** In the order of the given ids. */
  instances: RolledInitiative[];
  rolls: RollLogEntry[];
}

export function rollInitiative(
  deps: RollInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
  mode: InitiativeMode = "group",
): RollInitiativeResult {
  void deps;
  void instanceIds;
  void origin;
  void mode;
  throw new Error("not implemented");
}
