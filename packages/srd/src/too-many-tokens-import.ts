import { z } from "zod";
import { tooManyTokensIndexSchema } from "@ttrpg-agents/engine";

/** The names a folder is matched against, in mapping order. */
export interface TooManyTokensNames {
  /** Current monsters (monsters.json), matched by exact name. */
  monsters: readonly { key: string; name: string }[];
  /** Old names (aliases.json), as written, to current keys. */
  aliases: ReadonlyMap<string, string>;
  /** folder-keys.json: folder name to monster key. */
  folderKeys: Readonly<Record<string, string>>;
}

const REPO = "IsThisMyRealName/too-many-tokens-dnd";
const API = `https://api.github.com/repos/${REPO}`;
const HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ttrpg-agents-import",
};

const headSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) });

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});

/** A WebP file exactly one folder deep: `<folder>/<file>.webp`. */
const WEBP_IN_FOLDER = /^[^/]+\/[^/]+\.webp$/;

/** Code-unit order: the plain `<` and `>` on strings, never a locale collation. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

/** A folder's monster key: its exact current name, else its alias, else its folder-keys.json entry, else null. */
function keyOf(folder: string, names: TooManyTokensNames): string | null {
  const current = names.monsters.find((m) => m.name === folder);
  if (current) return current.key;
  const alias = names.aliases.get(folder);
  if (alias !== undefined) return alias;
  if (Object.hasOwn(names.folderKeys, folder)) {
    return names.folderKeys[folder] ?? null;
  }
  return null;
}

/** Fetch the pack's head commit and tree, build the index and return the text of index.json. Throws on an HTTP error or a truncated tree. */
export async function importTooManyTokensIndex(
  fetchFn: typeof fetch,
  names: TooManyTokensNames,
): Promise<string> {
  const head = headSchema.parse(await getJson(fetchFn, `${API}/commits/HEAD`));
  const commit = head.sha;
  const tree = treeSchema.parse(
    await getJson(fetchFn, `${API}/git/trees/${commit}?recursive=1`),
  );
  if (tree.truncated) {
    throw new Error(
      `${REPO} tree at ${commit} is truncated; nothing was written`,
    );
  }

  const filesByFolder = new Map<string, string[]>();
  for (const entry of tree.tree) {
    if (entry.type !== "blob" || !WEBP_IN_FOLDER.test(entry.path)) continue;
    const slash = entry.path.indexOf("/");
    const folder = entry.path.slice(0, slash);
    const files = filesByFolder.get(folder) ?? [];
    files.push(entry.path.slice(slash + 1));
    filesByFolder.set(folder, files);
  }

  const folders = [...filesByFolder]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([name, files]) => ({
      name,
      key: keyOf(name, names),
      files: files.sort(byCodeUnit),
    }));
  const index = tooManyTokensIndexSchema.parse({
    repo: REPO,
    commit,
    folders,
  });
  return JSON.stringify(index, null, 2) + "\n";
}
