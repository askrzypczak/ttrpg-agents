import type { Monster } from "./schema.js";
import type { MonsterIndex } from "./types.js";

/**
 * A search result: the monster and, when it matched by an old name, that alias
 * as written. The `alias` property is absent on a match on the current name.
 */
export interface MonsterMatch {
  monster: Monster;
  alias?: string;
}

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

/** The strongest score of any query variant against `text`. */
function bestScore(text: string, variants: string[]): number | undefined {
  let best: number | undefined;
  for (const v of variants) {
    const s = score(text, v);
    if (s !== undefined && (best === undefined || s < best)) best = s;
  }
  return best;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, plural-tolerant search over current names and old names
 * (aliases). Each monster appears once, with its best match: its name, or an
 * alias that points to it when that matches more strongly. Results are ranked
 * by match strength, then name matches before alias matches, then the shorter
 * monster name, then alphabetical. An alias hit carries the alias as written.
 * No match yields [].
 */
export function searchMonsters(
  index: MonsterIndex,
  query: string,
): MonsterMatch[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const variants = queryVariants(q);
  const aliasesByKey = new Map<string, string[]>();
  for (const [alias, key] of index.aliases) {
    const list = aliasesByKey.get(key) ?? [];
    list.push(alias);
    aliasesByKey.set(key, list);
  }
  const scored: { match: MonsterMatch; rank: number; viaAlias: boolean }[] = [];
  for (const monster of index.monsters) {
    const nameRank = bestScore(monster.name.toLowerCase(), variants);
    let bestAlias: { alias: string; rank: number } | undefined;
    for (const alias of aliasesByKey.get(monster.key) ?? []) {
      const rank = bestScore(alias.toLowerCase(), variants);
      if (
        rank !== undefined &&
        (bestAlias === undefined || rank < bestAlias.rank)
      ) {
        bestAlias = { alias, rank };
      }
    }
    if (
      bestAlias !== undefined &&
      (nameRank === undefined || bestAlias.rank < nameRank)
    ) {
      scored.push({
        match: { monster, alias: bestAlias.alias },
        rank: bestAlias.rank,
        viaAlias: true,
      });
    } else if (nameRank !== undefined) {
      scored.push({ match: { monster }, rank: nameRank, viaAlias: false });
    }
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(a.viaAlias) - Number(b.viaAlias) ||
        a.match.monster.name.length - b.match.monster.name.length ||
        a.match.monster.name.localeCompare(b.match.monster.name),
    )
    .map((s) => s.match);
}
