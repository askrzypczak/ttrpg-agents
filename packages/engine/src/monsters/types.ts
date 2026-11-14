import type { Monster } from "./schema.js";

/** The built-in monster data, loaded once (today's struct, renamed). */
export interface MonsterSet {
  /** All monsters, in source order. */
  monsters: Monster[];
  byKey: Map<string, Monster>;
  /** Old monster names, as written, mapped to the key of the current monster. */
  aliases: Map<string, string>;
  /** Monster key to its D&D Beyond 2024 page segment `<id>-<slug>`; no entry for a monster without a page. */
  dndBeyondPages: Map<string, string>;
}

/** Read port: every monster the engine can use. */
export interface MonsterIndex {
  /** The monster with this exact key, or undefined. */
  get(key: string): Monster | undefined;
  /** Every monster, in order. */
  list(): readonly Monster[];
  /** Old monster names, as written, mapped to the key of the current monster. */
  aliases(): ReadonlyMap<string, string>;
  /** The D&D Beyond 2024 page segment `<id>-<slug>` of a built-in monster, or undefined. */
  dndBeyondPage(key: string): string | undefined;
}

/** A MonsterIndex over a fixed MonsterSet (by reference). */
export function staticMonsterIndex(set: MonsterSet): MonsterIndex {
  return {
    get: (key) => set.byKey.get(key),
    list: () => set.monsters,
    aliases: () => set.aliases,
    dndBeyondPage: (key) => set.dndBeyondPages.get(key),
  };
}
