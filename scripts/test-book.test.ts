import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { monsterSchema, type Monster } from "@ttrpg-agents/engine";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const BOOK = join(REPO, "fixtures", "test-book");
const SRD = join(REPO, "packages", "srd", "data", "srd-5.2");

const EXPECTED_NAMES = [
  "Mirewick Lurker",
  "Cinderling Sentry",
  "Ashfeather Harrier",
  "Gloomcap Shambler",
];

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function keySuffix(key: string): string {
  const at = key.indexOf("_");
  return at === -1 ? key : key.slice(at + 1);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const creatures = readJson(join(BOOK, "creatures.json")) as Monster[];

function creatureNamed(name: string): Monster | undefined {
  return creatures.find((creature) => creature.name === name);
}

function readPages(): string[] {
  const dir = join(BOOK, "pages");
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => readFileSync(join(dir, entry), "utf8"));
}

describe("test book", () => {
  it("creatures.json holds the four test-book creatures in page order, each keyed test-book_ plus the slug of its name", () => {
    expect(creatures.map((creature) => creature.name)).toEqual(EXPECTED_NAMES);
    for (const creature of creatures) {
      expect(creature.key).toBe(`test-book_${slug(creature.name)}`);
    }
  });

  it.each(EXPECTED_NAMES)(
    "%s parses with monsterSchema and comes back unchanged",
    (name) => {
      const creature = creatureNamed(name);
      expect(creature).toBeDefined();
      expect(monsterSchema.parse(creature)).toStrictEqual(creature);
    },
  );

  it.each(EXPECTED_NAMES)(
    "%s appears on one of the test book's pages",
    (name) => {
      expect(creatureNamed(name)).toBeDefined();
      const pages = readPages();
      expect(pages.some((page) => page.includes(name))).toBe(true);
    },
  );

  it("no test-book creature name or key matches an SRD 5.2 monster name, key or alias", () => {
    expect(creatures).toHaveLength(4);
    const monsters = readJson(join(SRD, "monsters.json")) as {
      name: string;
      key: string;
    }[];
    const aliases = readJson(join(SRD, "aliases.json")) as {
      name: string;
      key: string;
    }[];
    const taken = new Set<string>();
    for (const entry of [...monsters, ...aliases]) {
      taken.add(slug(entry.name));
      taken.add(keySuffix(entry.key));
    }
    expect(taken.size).toBeGreaterThan(0);
    const clashes = creatures.flatMap((creature) =>
      [slug(creature.name), keySuffix(creature.key)].filter((id) =>
        taken.has(id),
      ),
    );
    expect(clashes).toEqual([]);
  });
});
