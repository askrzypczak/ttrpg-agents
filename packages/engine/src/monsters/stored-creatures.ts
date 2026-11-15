import type {
  EncounterDirectory,
  InstanceInEncounter,
} from "../encounter/directory.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { MonsterCheck } from "./check.js";
import type { CreateCreatureDeps } from "./create-creature.js";
import type { CreatureChanges } from "./creature-changes.js";
import type { Monster } from "./schema.js";
import type { MonsterIndex } from "./types.js";

/** The deps of editCreature and removeCreature. */
export interface CreatureCommandDeps extends CreateCreatureDeps {
  directory: CreateCreatureDeps["directory"] &
    Pick<EncounterDirectory, "findLiveInstancesOfMonster">;
}

export interface EditCreatureRequest {
  key: string;
  page?: number;
  changes: CreatureChanges;
}

export interface EditedCreature {
  /** As stored: its key is the row key. */
  monster: Monster;
  /** The stored statblock before the edit. */
  before: Monster;
  check: MonsterCheck;
  /** The live instances of the key, unchanged. */
  liveInstances: InstanceInEncounter[];
}

/** Applies the changes to a stored creature and replaces it under its key, notes the command on the current encounter and checks it. Throws UnknownMonsterError, BuiltInMonsterError, CreatureEntryError, InvalidCreatureError or CreatureNameTakenError, changing nothing. */
export function editCreature(
  deps: CreatureCommandDeps,
  request: EditCreatureRequest,
  origin: ChangeOrigin,
): EditedCreature {
  void deps;
  void request;
  void origin;
  throw new Error("not implemented");
}

export interface RemovedCreature {
  key: string;
  /** The statblock as it was, or undefined for a row that failed the schema. */
  monster: Monster | undefined;
}

/** Deletes a stored creature no live instance uses and notes the command on the current encounter. Throws UnknownMonsterError or CreatureInUseError, deleting nothing. */
export function removeCreature(
  deps: CreatureCommandDeps,
  key: string,
  origin: ChangeOrigin,
): RemovedCreature {
  void deps;
  void key;
  void origin;
  throw new Error("not implemented");
}

/** The stored creatures, of that book when given, sorted by key. */
export function listCreatures(
  monsters: MonsterIndex,
  book?: string,
): Monster[] {
  void monsters;
  void book;
  throw new Error("not implemented");
}
