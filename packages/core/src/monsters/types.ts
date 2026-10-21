import type { Monster } from "./schema.js";

export interface MonsterIndex {
  /** All monsters, in source order. */
  monsters: Monster[];
  byKey: Map<string, Monster>;
}
