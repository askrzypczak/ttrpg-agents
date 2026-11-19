import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tooManyTokensIndexSchema } from "@ttrpg-agents/engine";
import { loadSrdMonsters, loadTooManyTokensIndex } from "./loader.js";

const FOLDER_KEYS_URL = new URL(
  "../data/too-many-tokens/folder-keys.json",
  import.meta.url,
);

describe("committed TooManyTokens index", () => {
  it("loadTooManyTokensIndex loads the committed index, valid against the engine schema", () => {
    const index = loadTooManyTokensIndex();
    expect(tooManyTokensIndexSchema.safeParse(index).success).toBe(true);
    expect(index.folders.length).toBeGreaterThan(0);
  });

  it("every non-null key in the committed index is a monster key in monsters.json", () => {
    const index = loadTooManyTokensIndex();
    const { byKey } = loadSrdMonsters();
    const unknown = index.folders
      .filter((f) => f.key !== null && !byKey.has(f.key))
      .map((f) => `${f.name}: ${f.key}`);
    expect(unknown).toEqual([]);
    expect(index.folders.some((f) => f.key !== null)).toBe(true);
  });

  it("every folder-keys.json entry names a folder in the committed index", () => {
    const index = loadTooManyTokensIndex();
    const folderKeys = JSON.parse(
      readFileSync(FOLDER_KEYS_URL, "utf8"),
    ) as Record<string, string>;
    const names = new Set(index.folders.map((f) => f.name));
    const missing = Object.keys(folderKeys).filter((name) => !names.has(name));
    expect(missing).toEqual([]);
    expect(Object.keys(folderKeys).length).toBeGreaterThan(0);
  });
});
