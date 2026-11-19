import { describe, expect, it } from "vitest";
import { tooManyTokensIndexSchema } from "@ttrpg-agents/engine";
import {
  importTooManyTokensIndex,
  type TooManyTokensNames,
} from "./too-many-tokens-import.js";

const API = "https://api.github.com/repos/IsThisMyRealName/too-many-tokens-dnd";
const SHA = "8c791a0e75f1a254aea2ee8f7eaaf0515d693138";

type TreeEntry = { path: string; type: "tree" | "blob" };

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A fetch that answers the head-commit and tree calls of the GitHub API. */
function stubFetch(tree: TreeEntry[], truncated = false): typeof fetch {
  return (input) => {
    const url = urlOf(input);
    if (url === `${API}/commits/HEAD`) {
      return Promise.resolve(Response.json({ sha: SHA }));
    }
    if (url === `${API}/git/trees/${SHA}?recursive=1`) {
      return Promise.resolve(Response.json({ sha: SHA, truncated, tree }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
}

const noNames: TooManyTokensNames = {
  monsters: [],
  aliases: new Map(),
  folderKeys: {},
};

function folder(name: string, files: string[]): TreeEntry[] {
  return [
    { path: name, type: "tree" },
    ...files.map((f): TreeEntry => ({ path: `${name}/${f}`, type: "blob" })),
  ];
}

const tree: TreeEntry[] = [
  { path: "README.md", type: "blob" },
  ...folder("Goblin", [
    "GoblinForestMaleGraygreenMelee (1).webp",
    "GoblinForestMaleGraygreenMelee (10).webp",
    "GoblinForestMaleGraygreenMelee (2).webp",
  ]),
  ...folder("Will-o'-Wisp", [
    "WillOWispBlue (1).webp",
    "WillOWispBlue (2).webp",
  ]),
  ...folder("Hell Hound", ["HellHound.webp"]),
  ...folder("Bugbear Chief", ["BugbearChief.webp"]),
  ...folder("air elemental", ["AirElemental.webp"]),
];

const names: TooManyTokensNames = {
  monsters: [
    { key: "srd-2024_hell-hound", name: "Hell Hound" },
    { key: "srd-2024_will-o-wisp", name: "Will-o'-Wisp" },
  ],
  aliases: new Map(),
  folderKeys: { Goblin: "srd-2024_goblin-warrior" },
};

describe("importTooManyTokensIndex", () => {
  it("importTooManyTokensIndex refuses a truncated tree", async () => {
    await expect(
      importTooManyTokensIndex(stubFetch(tree, true), noNames),
    ).rejects.toThrow(/truncated/i);
    await expect(
      importTooManyTokensIndex(stubFetch(tree, false), noNames),
    ).resolves.toEqual(expect.any(String));
  });

  it("importTooManyTokensIndex produces the same text twice for the same commit, whatever order the tree lists its entries in", async () => {
    const first = await importTooManyTokensIndex(stubFetch(tree), names);
    const second = await importTooManyTokensIndex(
      stubFetch([...tree].reverse()),
      names,
    );
    expect(second).toBe(first);

    const index = tooManyTokensIndexSchema.parse(JSON.parse(first));
    expect(first).toBe(JSON.stringify(index, null, 2) + "\n");
    expect(index.commit).toBe(SHA);
    expect(index.repo).toBe("IsThisMyRealName/too-many-tokens-dnd");
    expect(index.folders.map((f) => f.name)).toContain("Goblin");
  });

  it("importTooManyTokensIndex sets a folder's key by current name, then alias, then folder-keys.json, else null", async () => {
    const mappingTree: TreeEntry[] = [
      ...folder("Hell Hound", ["HellHound.webp"]),
      ...folder("Swarm of Beetles", ["BeetleSwarm.webp"]),
      ...folder("Goblin", ["Goblin.webp"]),
      ...folder("Bugbear Chief", ["BugbearChief.webp"]),
    ];
    const mappingNames: TooManyTokensNames = {
      monsters: [
        { key: "srd-2024_hell-hound", name: "Hell Hound" },
        { key: "srd-2024_swarm-of-insects", name: "Swarm of Insects" },
        { key: "srd-2024_goblin-warrior", name: "Goblin Warrior" },
      ],
      aliases: new Map([
        ["Hell Hound", "srd-2024_alias-loses-to-name"],
        ["Swarm of Beetles", "srd-2024_swarm-of-insects"],
      ]),
      folderKeys: {
        "Hell Hound": "srd-2024_folder-key-loses-to-name",
        "Swarm of Beetles": "srd-2024_folder-key-loses-to-alias",
        Goblin: "srd-2024_goblin-warrior",
      },
    };
    const text = await importTooManyTokensIndex(
      stubFetch(mappingTree),
      mappingNames,
    );
    const index = tooManyTokensIndexSchema.parse(JSON.parse(text));
    expect(
      Object.fromEntries(index.folders.map((f) => [f.name, f.key])),
    ).toEqual({
      "Hell Hound": "srd-2024_hell-hound",
      "Swarm of Beetles": "srd-2024_swarm-of-insects",
      Goblin: "srd-2024_goblin-warrior",
      "Bugbear Chief": null,
    });
  });
});
