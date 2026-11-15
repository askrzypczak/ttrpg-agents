import type { EncounterDirectory } from "../encounter/directory.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { MonsterCheck } from "./check.js";
import type { CreatureChanges } from "./creature-changes.js";
import type { CreatureRepository } from "./creatures.js";
import type { Monster } from "./schema.js";
import type { MonsterIndex } from "./types.js";

export interface CreateCreatureRequest {
  /** Book tag: monsterSchema's source.book pattern, not reserved. */
  book: string;
  page?: number;
  /** Any key in the index: the changes apply to a copy of that statblock; without it, to the empty statblock. */
  from?: string;
  changes: CreatureChanges;
}

export interface CreateCreatureDeps {
  monsters: MonsterIndex;
  creatures: CreatureRepository;
  directory: Pick<
    EncounterDirectory,
    "transaction" | "getOpenScene" | "getCurrentEncounter" | "repositoryFor"
  >;
}

export interface CreatedCreature {
  /** As stored: its key is the row key. */
  monster: Monster;
  /** The statblock it was copied from, when `from` was given. */
  from?: Monster;
  check: MonsterCheck;
}

/** Builds, validates and stores a creature, notes the command on the current encounter and checks it. Throws BookTagError, UnknownMonsterError, CreatureEntryError, InvalidCreatureError or CreatureNameTakenError, storing nothing. */
export function createCreature(
  deps: CreateCreatureDeps,
  request: CreateCreatureRequest,
  origin: ChangeOrigin,
): CreatedCreature {
  void deps;
  void request;
  void origin;
  throw new Error("not implemented");
}
