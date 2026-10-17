import type { MonsterIndex } from "./loader.js";
import type { Monster } from "./schema.js";

/** Look up a monster by its exact key; undefined if absent. */
export function getMonsterByKey(
  index: MonsterIndex,
  key: string,
): Monster | undefined {
  return index.byKey.get(key);
}

/** The query plus singular forms of its last word (ghouls, harpies, ogres). */
function queryVariants(query: string): string[] {
  const variants = [query];
  const m = /^(.*?)(\S+)$/.exec(query);
  if (!m) return variants;
  const prefix = m[1] ?? "";
  const word = m[2] ?? "";
  if (word.endsWith("ies") && word.length > 3) {
    variants.push(prefix + word.slice(0, -3) + "y");
  }
  if (word.endsWith("ves") && word.length > 3) {
    const stem = prefix + word.slice(0, -3);
    variants.push(stem + "f", stem + "fe"); // wolves, knives
  }
  // The short stem only applies after sibilants: boxes -> box, but
  // mages -> mage (via the plain -s rule), not "mag".
  if (/(s|x|z|ch|sh)es$/.test(word)) {
    variants.push(prefix + word.slice(0, -2));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 1) {
    variants.push(prefix + word.slice(0, -1));
  }
  return variants;
}

/** 0 exact, 1 prefix, 2 whole-word match, 3 substring, undefined no match. */
function score(name: string, q: string): number | undefined {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}([^a-z0-9]|$)`).test(name)) {
    return 2;
  }
  if (name.includes(q)) return 3;
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, plural-tolerant name search. Results are ranked: exact
 * name, then name prefix, then whole-word match, then substring; ties go to
 * the shorter name, then alphabetical. No match yields [].
 */
export function searchMonsters(index: MonsterIndex, query: string): Monster[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const variants = queryVariants(q);
  const scored: { monster: Monster; rank: number }[] = [];
  for (const monster of index.monsters) {
    const name = monster.name.toLowerCase();
    let best: number | undefined;
    for (const v of variants) {
      const s = score(name, v);
      if (s !== undefined && (best === undefined || s < best)) best = s;
    }
    if (best !== undefined) scored.push({ monster, rank: best });
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.monster.name.length - b.monster.name.length ||
        a.monster.name.localeCompare(b.monster.name),
    )
    .map((s) => s.monster);
}
