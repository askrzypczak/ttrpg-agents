import { monsterSchema, type Monster } from "./schema.js";
import type { MonsterIndex, MonsterSet, QuarantinedCreature } from "./types.js";

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
  return book.startsWith("srd");
}

const SLUG = /^[a-z0-9-]+$/;

/** A stored record after its check: its statblock, or why it is quarantined. */
type CheckedRecord =
  { key: string; monster: Monster } | { key: string; reasons: string[] };

function checkRecord(record: CreatureRecord): CheckedRecord {
  const { key } = record;
  const result = monsterSchema.safeParse(record.data);
  if (!result.success) {
    return {
      key,
      reasons: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }
  const monster = result.data;
  const book = monster.source.book;
  const reasons: string[] = [];
  if (monster.key !== key) {
    reasons.push(`its statblock's key is "${monster.key}"`);
  }
  if (isReservedBookTag(book)) {
    reasons.push(`book "${book}" is reserved for built-in monsters`);
  }
  // The schema already checks the book tag, which has no "_".
  const prefix = `${book}_`;
  if (!key.startsWith(prefix) || !SLUG.test(key.slice(prefix.length))) {
    reasons.push(
      `key is not "${prefix}" followed by lower-case letters, digits and hyphens`,
    );
  }
  return reasons.length === 0 ? { key, monster } : { key, reasons };
}

function quarantine(key: string, reasons: string[]): QuarantinedCreature {
  return {
    key,
    message: `Stored creature "${key}" is quarantined: ${reasons.join("; ")}`,
  };
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
  const checkedRecords = (): CheckedRecord[] =>
    creatures.listRecords().map(checkRecord);
  return {
    get: (key) => {
      const known = builtIn.byKey.get(key);
      if (known !== undefined) return known;
      const record = creatures.getRecord(key);
      if (record === undefined) return undefined;
      const checked = checkRecord(record);
      return "monster" in checked ? checked.monster : undefined;
    },
    list: () => [
      ...builtIn.monsters,
      ...checkedRecords().flatMap((c) => ("monster" in c ? [c.monster] : [])),
    ],
    aliases: () => builtIn.aliases,
    dndBeyondPage: (key) => builtIn.dndBeyondPages.get(key),
    quarantined: () =>
      checkedRecords().flatMap((c) =>
        "reasons" in c ? [quarantine(c.key, c.reasons)] : [],
      ),
  };
}

/** Engine-internal. `message`, or `<message>. <quarantine message>` when `key` names a quarantined stored record. */
export function withQuarantineReason(
  index: MonsterIndex,
  key: string,
  message: string,
): string {
  const entry = index.quarantined().find((q) => q.key === key);
  return entry === undefined ? message : `${message}. ${entry.message}`;
}
