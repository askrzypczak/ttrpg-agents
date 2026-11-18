/** The names a folder is matched against, in mapping order. */
export interface TooManyTokensNames {
  /** Current monsters (monsters.json), matched by exact name. */
  monsters: readonly { key: string; name: string }[];
  /** Old names (aliases.json), as written, to current keys. */
  aliases: ReadonlyMap<string, string>;
  /** folder-keys.json: folder name to monster key. */
  folderKeys: Readonly<Record<string, string>>;
}

/** Fetch the pack's head commit and tree, build the index and return the text of index.json. Throws on an HTTP error or a truncated tree. */
export function importTooManyTokensIndex(
  fetchFn: typeof fetch,
  names: TooManyTokensNames,
): Promise<string> {
  void fetchFn;
  void names;
  return Promise.reject(new Error("not implemented"));
}
