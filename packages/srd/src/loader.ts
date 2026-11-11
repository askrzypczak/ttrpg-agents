import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  monsterSchema,
  type Monster,
  type MonsterIndex,
} from "@ttrpg-agents/engine";
import { z } from "zod";

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

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new MonsterLoadError(
      `${file}: invalid JSON (${(e as Error).message})`,
    );
  }
}

function loadFile(file: string): Monster[] {
  const data = readJsonFile(file);
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
 * {@link MonsterLoadError} on invalid data or on a key present twice. The
 * result has no aliases; add them with {@link loadAliases}.
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
  return { monsters, byKey, aliases: new Map() };
}

const aliasEntrySchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  note: z.string().min(1),
});

/** The entry's name when it has a usable one, else its position `#i`. */
function aliasLabel(raw: unknown, i: number): string {
  const name =
    typeof raw === "object" && raw !== null && "name" in raw
      ? raw.name
      : undefined;
  return typeof name === "string" && name !== "" ? name : `#${i}`;
}

/**
 * Add the aliases (old monster names) in `file` to `index`. The file holds a
 * JSON array of `{ name, key, note }`; the result maps each name, as written,
 * to its key. Throws {@link MonsterLoadError} naming the file and entry on
 * invalid data, an unknown key, an alias that is a current monster name, or
 * an alias repeated from an earlier entry (names compare case-insensitively).
 */
export function loadAliases(file: string, index: MonsterIndex): MonsterIndex {
  const data = readJsonFile(file);
  if (!Array.isArray(data)) {
    throw new MonsterLoadError(`${file}: expected an array of aliases`);
  }
  const currentNames = new Set(index.monsters.map((m) => m.name.toLowerCase()));
  const seen = new Set<string>();
  const aliases = new Map<string, string>();
  for (const [i, raw] of data.entries()) {
    const result = aliasEntrySchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new MonsterLoadError(
        `${file}: invalid alias "${aliasLabel(raw, i)}": ${issues}`,
      );
    }
    const { name, key } = result.data;
    const lower = name.toLowerCase();
    if (!index.byKey.has(key)) {
      throw new MonsterLoadError(
        `${file}: alias "${name}" points to unknown key "${key}"`,
      );
    }
    if (currentNames.has(lower)) {
      throw new MonsterLoadError(
        `${file}: alias "${name}" is the current name of a monster`,
      );
    }
    if (seen.has(lower)) {
      throw new MonsterLoadError(
        `${file}: alias "${name}" repeats an earlier alias`,
      );
    }
    seen.add(lower);
    aliases.set(name, key);
  }
  return { ...index, aliases };
}

/** Path of the committed SRD 5.2 snapshot (works from src/ and dist/). */
export const SRD_MONSTERS_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../data/srd-5.2/monsters.json",
);

/** Path of the committed SRD 5.1 name aliases for the snapshot (works from src/ and dist/). */
const SRD_ALIASES_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../data/srd-5.2/aliases.json",
);

/** Load the committed SRD 5.2 snapshot with its aliases (see {@link loadAliases}). */
export function loadSrdMonsters(): MonsterIndex {
  return loadAliases(
    SRD_ALIASES_PATH,
    loadMonsters([{ path: SRD_MONSTERS_PATH }]),
  );
}
