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
  const segment = index.dndBeyondPages.get(monster.key);
  return segment === undefined
    ? undefined
    : `https://www.dndbeyond.com/monsters/${encodeURIComponent(segment)}`;
}
