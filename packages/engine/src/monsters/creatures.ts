import { monsterSchema, type Monster } from "./schema.js";
import type { MonsterIndex, MonsterSet } from "./types.js";

/** A stored creature as the store holds it: its key and its statblock as parsed JSON, not validated. */
export interface CreatureRecord {
  key: string;
  data: unknown;
}

/** Writable driven port: the creatures the DM stored, one record per key. The store does not validate statblocks; createMonsterIndex does. */
export interface CreatureRepository {
  /** The record with this key, or undefined. */
  getRecord(key: string): CreatureRecord | undefined;
  /** Every record, in key order. */
  listRecords(): CreatureRecord[];
  /** Stores a new record; throws, storing nothing, when a record with this key exists. */
  insert(key: string, monster: Monster): void;
  /** Overwrites the record with this key; throws when there is none. */
  replace(key: string, monster: Monster): void;
  /** Deletes the record with this key; does nothing when there is none. */
  delete(key: string): void;
}

/**
 * Whether a book tag is reserved for built-in data: it begins with "srd".
 * Engine-internal. A monster with a tag that is not reserved counts as stored,
 * because creation and edit keep every stored record off reserved tags.
 */
export function isReservedBookTag(book: string): boolean {
  return book.startsWith("srd");
}

/** The record's statblock, or undefined when it fails monsterSchema. */
function parseRecord(record: CreatureRecord): Monster | undefined {
  const result = monsterSchema.safeParse(record.data);
  return result.success ? result.data : undefined;
}

/**
 * A MonsterIndex over the built-in set and the stored creatures, reading the
 * repository on every call. get: built-in first, then a stored record that
 * parses. list: built-in monsters in set order, then the stored creatures that
 * parse, in the repository's order. A stored record that fails monsterSchema is
 * skipped (a schema change migrates the rows; this is a safety net). aliases and
 * dndBeyondPage: the built-in set's.
 */
export function createMonsterIndex(
  builtIn: MonsterSet,
  creatures: CreatureRepository,
): MonsterIndex {
  return {
    get: (key) => {
      const known = builtIn.byKey.get(key);
      if (known !== undefined) return known;
      const record = creatures.getRecord(key);
      return record === undefined ? undefined : parseRecord(record);
    },
    list: () => [
      ...builtIn.monsters,
      ...creatures.listRecords().flatMap((record) => {
        const monster = parseRecord(record);
        return monster === undefined ? [] : [monster];
      }),
    ],
    aliases: () => builtIn.aliases,
    dndBeyondPage: (key) => builtIn.dndBeyondPages.get(key),
  };
}
