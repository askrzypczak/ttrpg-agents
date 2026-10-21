import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  monsterSchema,
  type Monster,
  type MonsterIndex,
} from "@ttrpg-agents/engine";

/**
 * A place to load monsters from: a JSON file holding an array of monsters, or
 * a directory whose `*.json` files each hold such an array (non-recursive).
 */
export interface MonsterFileSource {
  path: string;
}

export class MonsterLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonsterLoadError";
  }
}

function filesOf(path: string): string[] {
  let isDir: boolean;
  try {
    isDir = statSync(path).isDirectory();
  } catch (e) {
    throw new MonsterLoadError(
      `${path}: cannot read monster source (${(e as Error).message})`,
    );
  }
  if (!isDir) return [path];
  return readdirSync(path)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(path, f));
}

function loadFile(file: string): Monster[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new MonsterLoadError(
      `${file}: invalid JSON (${(e as Error).message})`,
    );
  }
  if (!Array.isArray(data)) {
    throw new MonsterLoadError(`${file}: expected an array of monsters`);
  }
  return data.map((raw: unknown, i) => {
    const result = monsterSchema.safeParse(raw);
    if (result.success) return result.data;
    const key =
      typeof raw === "object" && raw !== null && "key" in raw
        ? String((raw as { key: unknown }).key)
        : `#${i}`;
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new MonsterLoadError(`${file}: invalid monster "${key}": ${issues}`);
  });
}

/**
 * Load, validate and merge monsters from several sources. Throws
 * {@link MonsterLoadError} on invalid data or on a key present twice.
 */
export function loadMonsters(sources: MonsterFileSource[]): MonsterIndex {
  const monsters: Monster[] = [];
  const byKey = new Map<string, Monster>();
  const origin = new Map<string, string>();
  for (const source of sources) {
    for (const file of filesOf(source.path)) {
      for (const monster of loadFile(file)) {
        const prior = origin.get(monster.key);
        if (prior !== undefined) {
          throw new MonsterLoadError(
            `${file}: duplicate monster key "${monster.key}" (already loaded from ${prior})`,
          );
        }
        origin.set(monster.key, file);
        byKey.set(monster.key, monster);
        monsters.push(monster);
      }
    }
  }
  return { monsters, byKey };
}

/** Path of the committed SRD 5.2 snapshot (works from src/ and dist/). */
export const SRD_MONSTERS_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../data/srd-5.2/monsters.json",
);

export function loadSrdMonsters(): MonsterIndex {
  return loadMonsters([{ path: SRD_MONSTERS_PATH }]);
}
