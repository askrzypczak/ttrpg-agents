import type { Monster } from "./schema.js";
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
 * because the quarantine keeps every valid stored record off reserved tags.
 */
export function isReservedBookTag(book: string): boolean {
  void book;
  throw new Error("not implemented");
}

/**
 * A MonsterIndex over the built-in set and the stored creatures, reading the
 * repository on every call. get: built-in first, then a valid stored record.
 * list: built-in monsters in set order, then valid stored creatures in the
 * repository's order. aliases and dndBeyondPage: the built-in set's.
 * quarantined: every stored record that fails monsterSchema, whose statblock
 * key differs from its record key, whose book tag is reserved, or whose key is
 * not `<source.book>_<slug>` with a slug of one or more of [a-z0-9-].
 */
export function createMonsterIndex(
  builtIn: MonsterSet,
  creatures: CreatureRepository,
): MonsterIndex {
  void builtIn;
  void creatures;
  throw new Error("not implemented");
}

/** Engine-internal. `message`, or `<message>. <quarantine message>` when `key` names a quarantined stored record. */
export function withQuarantineReason(
  index: MonsterIndex,
  key: string,
  message: string,
): string {
  void index;
  void key;
  void message;
  throw new Error("not implemented");
}
