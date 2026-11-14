import type { Monster } from "./schema.js";

export interface MonsterIndex {
  /** All monsters, in source order. */
  monsters: Monster[];
  byKey: Map<string, Monster>;
  /** Old monster names, as written, mapped to the key of the current monster. */
  aliases: Map<string, string>;
  /**
   * Monster key to the path segment `<id>-<slug>` of its D&D Beyond 2024 page
   * (the part after `/monsters/`). A monster without a page has no entry.
   */
  dndBeyondPages: Map<string, string>;
}

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

/** A MonsterIndex over a fixed MonsterSet (by reference). */
export function staticMonsterIndex(set: MonsterSet): MonsterIndex {
  void set;
  throw new Error("not implemented");
}
