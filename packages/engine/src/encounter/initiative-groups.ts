import type { RollLogEntry } from "../dice/log.js";
import type { RollInitiativeDeps } from "./initiative.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export interface SplitInitiativeDeps extends RollInitiativeDeps {
  /** Source of group ids; injected so the engine stays free of Node. */
  newGroupId: () => string;
}

export interface MergeInitiativeDeps {
  repo: EncounterRepository;
  newGroupId: () => string;
}

export interface SplitInitiativeOptions {
  /** Roll each instance its own new initiative; default false keeps each value. */
  roll?: boolean;
}

/** One instance after a split or merge was written. */
export interface RegroupedInstance {
  instance: MonsterInstance;
  /** Initiative before the change; null when it had none. */
  before: number | null;
  /** The d20 and modifier of a rolled split; absent when nothing was rolled. */
  rolled?: { roll: number; modifier: number };
}

export interface SplitInitiativeResult {
  /** In the order of the given ids. */
  instances: RegroupedInstance[];
  /** One entry per d20 rolled; empty without `roll`. */
  rolls: RollLogEntry[];
}

export interface MergeInitiativeResult {
  /** In the order of the given ids. */
  instances: RegroupedInstance[];
  /** The initiative the group shares; null when no named instance has one. */
  initiative: number | null;
}

export function splitInitiative(
  deps: SplitInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
  options?: SplitInitiativeOptions,
): SplitInitiativeResult {
  void deps;
  void instanceIds;
  void origin;
  void options;
  throw new Error("not implemented");
}

export function mergeInitiative(
  deps: MergeInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
): MergeInitiativeResult {
  void deps;
  void instanceIds;
  void origin;
  throw new Error("not implemented");
}
