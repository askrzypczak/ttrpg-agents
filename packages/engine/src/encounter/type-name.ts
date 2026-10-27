import type { MonsterInstance } from "./types.js";

/**
 * The name of a monster type for the GM: the display name of the first
 * instance of the type whose name ends in " <n>" (the default naming),
 * without that suffix; else the monster key.
 */
export function monsterTypeName(
  instances: readonly Pick<MonsterInstance, "monsterKey" | "displayName">[],
  monsterKey: string,
): string {
  void instances;
  void monsterKey;
  throw new Error("not implemented");
}
