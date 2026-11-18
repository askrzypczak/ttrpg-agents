import { describe, expect, it } from "vitest";
import {
  defaultVariant,
  tooManyTokensUrls,
  tooManyTokensVariants,
  type TooManyTokensIndex,
} from "./too-many-tokens.js";

const REPO = "IsThisMyRealName/too-many-tokens-dnd";
const COMMIT = "8c791a0e75f1a254aea2ee8f7eaaf0515d693138";

function indexOf(folders: TooManyTokensIndex["folders"]): TooManyTokensIndex {
  return { repo: REPO, commit: COMMIT, folders };
}

// Deliberately unsorted: folders and files are out of order.
const swarms = indexOf([
  {
    name: "Swarm of spiders",
    key: "srd-2024_swarm-of-insects",
    files: ["SpiderSwarm (2).webp", "SpiderSwarm (1).webp"],
  },
  { name: "Goblin", key: "srd-2024_goblin-warrior", files: ["Goblin.webp"] },
  {
    name: "Swarm of Wasps",
    key: "srd-2024_swarm-of-insects",
    files: ["WaspSwarm.webp"],
  },
  {
    name: "Swarm of Insects",
    key: "srd-2024_swarm-of-insects",
    files: ["InsectSwarm (2).webp", "InsectSwarm (1).webp"],
  },
  {
    name: "Swarm of Beetles",
    key: "srd-2024_swarm-of-insects",
    files: ["BeetleSwarm.webp"],
  },
  { name: "Bugbear Chief", key: null, files: ["BugbearChief.webp"] },
]);

const swarmOfInsects = {
  key: "srd-2024_swarm-of-insects",
  name: "Swarm of Insects",
};

describe("tooManyTokensVariants", () => {
  it("tooManyTokensVariants lists the files of every folder whose key is the monster's key", () => {
    const index = indexOf([
      {
        name: "Goblin",
        key: "srd-2024_goblin-warrior",
        files: ["Goblin.webp"],
      },
      {
        name: "Swarm of Wasps",
        key: "srd-2024_swarm-of-insects",
        files: ["WaspSwarm (2).webp", "WaspSwarm (1).webp"],
      },
      { name: "Bugbear Chief", key: null, files: ["BugbearChief.webp"] },
      {
        name: "Swarm of Beetles",
        key: "srd-2024_swarm-of-insects",
        files: ["BeetleSwarm.webp"],
      },
    ]);
    expect(tooManyTokensVariants(index, swarmOfInsects)).toEqual([
      { folder: "Swarm of Beetles", file: "BeetleSwarm.webp" },
      { folder: "Swarm of Wasps", file: "WaspSwarm (1).webp" },
      { folder: "Swarm of Wasps", file: "WaspSwarm (2).webp" },
    ]);
  });

  it("tooManyTokensVariants falls back to the folders named like the monster, case-insensitively, when no folder has its key", () => {
    const index = indexOf([
      {
        name: "Goblin",
        key: "srd-2024_goblin-warrior",
        files: ["Goblin.webp"],
      },
      { name: "Goblin boss", key: "some-other-key", files: ["Boss2.webp"] },
      { name: "Bugbear Chief", key: null, files: ["BugbearChief.webp"] },
      { name: "GOBLIN BOSS", key: null, files: ["Boss1.webp"] },
    ]);
    expect(
      tooManyTokensVariants(index, {
        key: "srd-2024_goblin-boss",
        name: "Goblin Boss",
      }),
    ).toEqual([
      { folder: "GOBLIN BOSS", file: "Boss1.webp" },
      { folder: "Goblin boss", file: "Boss2.webp" },
    ]);
  });

  it("tooManyTokensVariants puts the folder named like the monster's current name first, then its other folders in code-unit order", () => {
    const folders = tooManyTokensVariants(swarms, swarmOfInsects).map(
      (v) => v.folder,
    );
    expect([...new Set(folders)]).toEqual([
      "Swarm of Insects",
      "Swarm of Beetles",
      "Swarm of Wasps",
      "Swarm of spiders",
    ]);
  });

  it("tooManyTokensVariants orders the files within a folder in code-unit order", () => {
    const index = indexOf([
      {
        name: "Zombie",
        key: "srd-2024_zombie",
        files: [
          "air.webp",
          "b (2).webp",
          "Zombie.webp",
          "b (10).webp",
          "B.webp",
        ],
      },
    ]);
    expect(
      tooManyTokensVariants(index, { key: "srd-2024_zombie", name: "Zombie" }),
    ).toEqual([
      { folder: "Zombie", file: "B.webp" },
      { folder: "Zombie", file: "Zombie.webp" },
      { folder: "Zombie", file: "air.webp" },
      { folder: "Zombie", file: "b (10).webp" },
      { folder: "Zombie", file: "b (2).webp" },
    ]);
  });
});

describe("defaultVariant", () => {
  it("defaultVariant is the first variant, and undefined for a monster with no folder by key or name", () => {
    expect(defaultVariant(swarms, swarmOfInsects)).toEqual({
      folder: "Swarm of Insects",
      file: "InsectSwarm (1).webp",
    });
    expect(defaultVariant(swarms, swarmOfInsects)).toEqual(
      tooManyTokensVariants(swarms, swarmOfInsects)[0],
    );
    expect(
      defaultVariant(swarms, { key: "srd-2024_lich", name: "Lich" }),
    ).toBeUndefined();
  });
});

describe("tooManyTokensUrls", () => {
  it("tooManyTokensUrls gives the jsDelivr and raw.githubusercontent.com URLs pinned to the index's commit", () => {
    const index = indexOf([]);
    expect(
      tooManyTokensUrls(index, {
        folder: "Goblin",
        file: "GoblinForestMaleGraygreenMelee.webp",
      }),
    ).toEqual({
      jsdelivr: `https://cdn.jsdelivr.net/gh/${REPO}@${COMMIT}/Goblin/GoblinForestMaleGraygreenMelee.webp`,
      raw: `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Goblin/GoblinForestMaleGraygreenMelee.webp`,
    });
  });

  it("tooManyTokensUrls percent-encodes spaces, parentheses and apostrophes in each path segment", () => {
    const index = indexOf([]);
    expect(
      tooManyTokensUrls(index, {
        folder: "Goblin",
        file: "GoblinForestMaleGraygreenMelee (1).webp",
      }),
    ).toEqual({
      jsdelivr: `https://cdn.jsdelivr.net/gh/${REPO}@${COMMIT}/Goblin/GoblinForestMaleGraygreenMelee%20%281%29.webp`,
      raw: `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Goblin/GoblinForestMaleGraygreenMelee%20%281%29.webp`,
    });
    expect(
      tooManyTokensUrls(index, {
        folder: "Will-o'-Wisp",
        file: "WillOWispBlue (1).webp",
      }),
    ).toEqual({
      jsdelivr: `https://cdn.jsdelivr.net/gh/${REPO}@${COMMIT}/Will-o%27-Wisp/WillOWispBlue%20%281%29.webp`,
      raw: `https://raw.githubusercontent.com/${REPO}/${COMMIT}/Will-o%27-Wisp/WillOWispBlue%20%281%29.webp`,
    });
  });
});
