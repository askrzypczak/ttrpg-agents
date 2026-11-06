import type { Monster } from "./schema.js";

export interface MonsterIndex {
  /** All monsters, in source order. */
  monsters: Monster[];
  byKey: Map<string, Monster>;
  /** Old monster names, as written, mapped to the key of the current monster. */
  aliases: Map<string, string>;
}
