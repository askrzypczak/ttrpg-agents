import type { Monster } from "./schema.js";
import type { MonsterIndex } from "./types.js";

/**
 * The URL of the monster's D&D Beyond 2024 Monster Manual page, or undefined
 * when it has none.
 */
export function dndBeyondUrl(
  index: MonsterIndex,
  monster: Monster,
): string | undefined {
  void index;
  void monster;
  throw new Error("not implemented");
}
