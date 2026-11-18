import {
  noteCommandOnCurrentEncounter,
  type EncounterDirectory,
} from "../encounter/directory.js";
import { UnknownMonsterError } from "../encounter/errors.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import { checkMonster, type MonsterCheck } from "./check.js";
import {
  applyCreatureChanges,
  assertCreatureNameFree,
  creatureKey,
  nameWithoutKeyError,
  parseCreatureDraft,
  type CreatureChanges,
  type CreatureDraft,
} from "./creature-changes.js";
import { isReservedBookTag, type CreatureRepository } from "./creatures.js";
import { BookTagError, CreatureNameTakenError } from "./errors.js";
import { monsterSchema, type Monster } from "./schema.js";
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

/** The statblock a create from scratch starts from: what a statblock may print empty starts empty; every other field must come from the changes. */
function emptyStatblock(): CreatureDraft {
  return {
    armorDetail: "",
    skills: {},
    senses: {},
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
  };
}

/** Throws BookTagError for a tag outside monsterSchema's pattern or one reserved for built-in data. */
function assertBookTag(book: string): void {
  if (!monsterSchema.shape.source.shape.book.safeParse(book).success)
    throw new BookTagError(
      `"${book}" is not a book tag: use lower-case letters, digits and hyphens, starting with a letter or digit, such as "homebrew" or "mm-2024".`,
    );
  if (isReservedBookTag(book))
    throw new BookTagError(
      `The book tag "${book}" is reserved for the built-in SRD monsters; use another, such as "homebrew".`,
    );
}

/** Builds, validates and stores a creature, notes the command on the current encounter and checks it. Throws BookTagError, UnknownMonsterError, CreatureEntryError, InvalidCreatureError or CreatureNameTakenError, storing nothing. */
export function createCreature(
  deps: CreateCreatureDeps,
  request: CreateCreatureRequest,
  origin: ChangeOrigin,
): CreatedCreature {
  const { monsters, creatures, directory } = deps;
  const { book, page, from: fromKey } = request;
  assertBookTag(book);

  let from: Monster | undefined;
  if (fromKey !== undefined) {
    from = monsters.get(fromKey);
    if (from === undefined)
      throw new UnknownMonsterError(
        `Unknown monster "${fromKey}". Use search_monsters to find keys.`,
      );
  }
  // applyCreatureChanges copies its base, so the built-in set is never changed.
  const draft = applyCreatureChanges(from ?? emptyStatblock(), request.changes);
  draft.source = page === undefined ? { book } : { book, page };
  const parsed = parseCreatureDraft(draft);
  const key = creatureKey(book, parsed.name);
  if (key === undefined) throw nameWithoutKeyError();
  const monster: Monster = { ...parsed, key };

  directory.transaction(() => {
    // Another process shares the database: check under the write lock.
    assertCreatureNameFree(monsters, book, monster.name);
    if (creatures.getRecord(key) !== undefined) {
      const holder = monsters.get(key);
      const named = holder ? `"${holder.name}"` : "a stored creature";
      throw new CreatureNameTakenError(
        `The key ${key} is taken by ${named}. Change that creature with edit_creature, or pick another name.`,
      );
    }
    creatures.insert(key, monster);
    noteCommandOnCurrentEncounter(directory, origin);
  });

  const check = checkMonster(monster);
  return from === undefined ? { monster, check } : { monster, from, check };
}
