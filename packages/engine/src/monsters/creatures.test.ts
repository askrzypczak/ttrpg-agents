import { describe, expect, it } from "vitest";
import {
  makeTestCreatureRepository,
  makeTestMonster,
} from "../testing/index.js";
import { createMonsterIndex } from "./creatures.js";
import type { Monster } from "./schema.js";
import { searchMonsters } from "./search.js";
import type { MonsterSet } from "./types.js";

function creature(key: string, name: string, book: string): Monster {
  return makeTestMonster({ key, name, source: { book } });
}

const shadow = creature("srd-2024_shadow", "Shadow", "srd-5.2");
const ghoul = creature("srd-2024_ghoul", "Ghoul", "srd-5.2");
const thornling = creature("homebrew_thornling", "Thornling", "homebrew");
const mossback = creature("homebrew_mossback", "Mossback", "homebrew");

function builtInSet(
  aliases: Record<string, string> = {},
  dndBeyondPages: Record<string, string> = {},
): MonsterSet {
  const monsters = [shadow, ghoul];
  return {
    monsters,
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(Object.entries(aliases)),
    dndBeyondPages: new Map(Object.entries(dndBeyondPages)),
  };
}

describe("createMonsterIndex", () => {
  it("createMonsterIndex gets a valid stored creature by key and lists it after every built-in monster", () => {
    const repo = makeTestCreatureRepository();
    repo.insert(thornling.key, thornling);
    repo.insert(mossback.key, mossback);
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.get("homebrew_thornling")).toEqual(thornling);
    expect(index.get("srd-2024_shadow")).toEqual(shadow);
    expect(index.list()).toEqual([shadow, ghoul, mossback, thornling]);
  });

  it("createMonsterIndex reads the repository on each call, so a record inserted after the index was built is returned by get and list", () => {
    const repo = makeTestCreatureRepository();
    const index = createMonsterIndex(builtInSet(), repo);
    expect(index.get("homebrew_thornling")).toBeUndefined();
    expect(index.list()).toEqual([shadow, ghoul]);

    repo.insert(thornling.key, thornling);

    expect(index.get("homebrew_thornling")).toEqual(thornling);
    expect(index.list()).toEqual([shadow, ghoul, thornling]);
  });

  it("a stored record that fails monsterSchema is skipped by get and list while the valid stored records and every built-in monster still load", () => {
    const repo = makeTestCreatureRepository();
    repo.insert(mossback.key, mossback);
    repo.put("homebrew_thornling", { ...thornling, ac: "eleven" });
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.get("homebrew_thornling")).toBeUndefined();
    expect(index.get("homebrew_mossback")).toEqual(mossback);
    expect(index.get("srd-2024_ghoul")).toEqual(ghoul);
    expect(index.list()).toEqual([shadow, ghoul, mossback]);
    expect(searchMonsters(index, "thornling")).toEqual([]);
  });

  it("createMonsterIndex serves the built-in set's aliases and D&D Beyond pages, and no page for a stored creature", () => {
    const repo = makeTestCreatureRepository();
    repo.insert(thornling.key, thornling);
    const index = createMonsterIndex(
      builtInSet(
        { Wight: "srd-2024_ghoul" },
        { "srd-2024_shadow": "9000001-shadow" },
      ),
      repo,
    );

    expect([...index.aliases()]).toEqual([["Wight", "srd-2024_ghoul"]]);
    expect(index.dndBeyondPage("srd-2024_shadow")).toBe("9000001-shadow");
    expect(index.dndBeyondPage("srd-2024_ghoul")).toBeUndefined();
    expect(index.dndBeyondPage("homebrew_thornling")).toBeUndefined();
  });
});
