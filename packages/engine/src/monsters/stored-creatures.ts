import {
  noteCommandOnCurrentEncounter,
  type EncounterDirectory,
  type InstanceInEncounter,
} from "../encounter/directory.js";
import { UnknownMonsterError } from "../encounter/errors.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import { checkMonster, type MonsterCheck } from "./check.js";
import type { CreateCreatureDeps } from "./create-creature.js";
import {
  applyCreatureChanges,
  assertCreatureNameFree,
  parseCreatureDraft,
  type CreatureChanges,
} from "./creature-changes.js";
import { isReservedBookTag } from "./creatures.js";
import { BuiltInMonsterError, CreatureInUseError } from "./errors.js";
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
  const { monsters, creatures, directory } = deps;
  const { key, page } = request;

  // Another process shares the database: read and write under the write lock.
  const { monster, before, liveInstances } = directory.transaction(() => {
    const current = monsters.get(key);
    if (current === undefined)
      throw new UnknownMonsterError(
        `No stored creature has the key "${key}". Use list_creatures to find keys.`,
      );
    const book = current.source.book;
    if (isReservedBookTag(book))
      throw new BuiltInMonsterError(
        `${current.name} (${key}) is a built-in SRD monster and cannot be changed. Store a changed copy with create_creature, from: ${key}.`,
      );
    const draft = applyCreatureChanges(current, request.changes);
    if (page !== undefined) draft.source = { book, page };
    const edited: Monster = { ...parseCreatureDraft(draft), key };
    assertCreatureNameFree(monsters, book, edited.name, key);
    creatures.replace(key, edited);
    noteCommandOnCurrentEncounter(directory, origin);
    return {
      monster: edited,
      before: current,
      liveInstances: directory.findLiveInstancesOfMonster(key),
    };
  });

  return { monster, before, check: checkMonster(monster), liveInstances };
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
  const { monsters, creatures, directory } = deps;
  return directory.transaction(() => {
    if (creatures.getRecord(key) === undefined)
      throw new UnknownMonsterError(
        `"${key}" is not a stored creature; list_creatures lists them. Built-in SRD monsters cannot be removed.`,
      );
    const monster = monsters.get(key);
    const live = directory.findLiveInstancesOfMonster(key);
    if (live.length > 0) {
      const users = live
        .map(
          ({ encounter, instance }) =>
            `${instance.displayName} (${encounter.name})`,
        )
        .join(", ");
      const named = monster === undefined ? key : `${monster.name} (${key})`;
      throw new CreatureInUseError(
        `${named} is used by ${users}. Remove them with remove_monsters, or give them another type with change_monster_type, then remove the creature. Nothing was removed.`,
      );
    }
    creatures.delete(key);
    noteCommandOnCurrentEncounter(directory, origin);
    return { key, monster };
  });
}

/** The stored creatures, of that book when given, sorted by key. */
export function listCreatures(
  monsters: MonsterIndex,
  book?: string,
): Monster[] {
  return monsters
    .list()
    .filter(
      (m) =>
        !isReservedBookTag(m.source.book) &&
        (book === undefined || m.source.book === book),
    )
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
