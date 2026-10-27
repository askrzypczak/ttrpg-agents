import type { MonsterInstance } from "./types.js";

/** A default display name: the type's name, a space and a number. */
const NUMBERED = /^(.*\S) \d+$/;

/**
 * The name of a monster type for the GM: the display name of the first
 * instance of the type whose name ends in " <n>" (the default naming),
 * without that suffix; else the monster key.
 */
export function monsterTypeName(
  instances: readonly Pick<MonsterInstance, "monsterKey" | "displayName">[],
  monsterKey: string,
): string {
  for (const instance of instances) {
    if (instance.monsterKey !== monsterKey) continue;
    const name = NUMBERED.exec(instance.displayName)?.[1];
    if (name !== undefined) return name;
  }
  return monsterKey;
}
