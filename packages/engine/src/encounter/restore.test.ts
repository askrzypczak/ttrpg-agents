import { describe, expect, it } from "vitest";
import {
  makeTestImageSource,
  makeTestInstance,
  makeTestMonster,
  makeTestMonsterIndex,
  makeTestTooManyTokensIndex,
  webpDeclaring,
} from "../testing/index.js";
import type { DefaultArtDeps } from "./default-art.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, RemovedInstance } from "./repository.js";
import {
  canRestoreEncounter,
  restoreEncounterWithDefaultArt,
  restoreMonstersWithDefaultArt,
} from "./restore.js";
import type { StoredTokenArt, TokenArtRepository } from "./token-art.js";
import type { TokenImageRepository } from "./token-image.js";
import { tooManyTokensUrls } from "./too-many-tokens.js";

const removedBy: ChangeOrigin = { source: "mcp", commandId: "cmd-1" };

const removed = (n: number, cleared: boolean): RemovedInstance => ({
  instance: makeTestInstance({
    id: `wolf-${String(n)}`,
    monsterKey: "srd-2024_wolf",
    displayName: `Wolf ${String(n)}`,
    createdAt: n,
  }),
  removedBy,
  cleared,
});

const repoHolding = (list: RemovedInstance[]) => ({
  listRemovedInstances: () => list,
});

describe("canRestoreEncounter", () => {
  it("canRestoreEncounter is true while the last clear left monsters not restored since, and false otherwise", () => {
    // The last clear's monsters, not restored since.
    expect(canRestoreEncounter(repoHolding([removed(1, true)]))).toBe(true);
    expect(
      canRestoreEncounter(repoHolding([removed(1, false), removed(2, true)])),
    ).toBe(true);

    // Nothing removed, or only monsters removed one by one.
    expect(canRestoreEncounter(repoHolding([]))).toBe(false);
    expect(
      canRestoreEncounter(repoHolding([removed(1, false), removed(2, false)])),
    ).toBe(false);
  });
});

const restoredBy: ChangeOrigin = { source: "mcp", commandId: "cmd-2" };

/** The Wolf's TooManyTokens default: one folder keyed to it. */
const wolfIndex = makeTestTooManyTokensIndex([
  { name: "Wolf", key: "srd-2024_wolf", files: ["Wolf_01.webp"] },
]);
const wolfUrls = tooManyTokensUrls(wolfIndex, {
  folder: "Wolf",
  file: "Wolf_01.webp",
});

/**
 * Deps over the given removed instances whose store, art and image stores
 * record in one list, in order: the outermost art transaction's start and
 * end, each art and image write, and each restore, with whether it ran inside
 * the art transaction.
 */
function artDeps(list: RemovedInstance[]) {
  const log: string[] = [];
  let depth = 0;
  const repo = {
    listRemovedInstances: () => structuredClone(list),
    listInstances: () => [],
    restoreInstances: (ids: readonly string[]) => {
      log.push(`restore ${depth > 0 ? "in" : "outside"} transaction`);
      return list
        .filter((r) => ids.includes(r.instance.id))
        .map((r) => ({ ...r.instance }));
    },
    transaction: <T>(fn: () => T): T => fn(),
  } as unknown as EncounterRepository;
  const stored: Record<string, StoredTokenArt> = {};
  const art: TokenArtRepository = {
    listTokenArt: () =>
      Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.art])),
    getTokenArt: (key) =>
      Object.hasOwn(stored, key) ? stored[key] : undefined,
    setTokenArt(key, value, source) {
      log.push(`set-art ${key}`);
      stored[key] = { art: value, source };
    },
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      if (outer) log.push("begin");
      depth += 1;
      try {
        const result = fn();
        if (outer) log.push("commit");
        return result;
      } finally {
        depth -= 1;
      }
    },
  };
  const images: TokenImageRepository = {
    saveTokenImage() {
      log.push("save-image");
      return "a".repeat(64);
    },
    getTokenImage: () => undefined,
  };
  const defaultArt: DefaultArtDeps = {
    art,
    images,
    imageSource: makeTestImageSource({
      [wolfUrls.jsdelivr]: webpDeclaring(256, 256),
    }),
    tooManyTokens: wolfIndex,
  };
  const deps = {
    repo,
    monsters: makeTestMonsterIndex([
      makeTestMonster({ key: "srd-2024_wolf", name: "Wolf" }),
    ]),
    defaultArt,
  };
  return { deps, log, stored };
}

/** The writes of a restore of a Wolf with no art: its art, then the restore, in one art transaction. */
const artThenRestore = [
  "begin",
  "save-image",
  "set-art srd-2024_wolf",
  "restore in transaction",
  "commit",
];

describe("restores with the TooManyTokens default art", () => {
  it("restoreMonstersWithDefaultArt writes a restored type's art before the restored instances in one transaction", async () => {
    const { deps, log, stored } = artDeps([removed(1, false)]);

    const result = await restoreMonstersWithDefaultArt(
      deps,
      ["Wolf 1"],
      restoredBy,
    );

    expect(result.restored.map((r) => r.instance.id)).toEqual(["wolf-1"]);
    expect(result.art).toEqual([
      { outcome: "set", monsterKey: "srd-2024_wolf", name: "Wolf" },
    ]);
    expect(log).toEqual(artThenRestore);
    expect(stored["srd-2024_wolf"]?.source).toBe("default");
  });

  it("restoreEncounterWithDefaultArt writes a restored type's art before the restored instances in one transaction", async () => {
    const { deps, log, stored } = artDeps([removed(1, true), removed(2, true)]);

    const result = await restoreEncounterWithDefaultArt(deps, restoredBy);

    expect(result.restored.map((r) => r.instance.id)).toEqual([
      "wolf-1",
      "wolf-2",
    ]);
    expect(result.art).toEqual([
      { outcome: "set", monsterKey: "srd-2024_wolf", name: "Wolf" },
    ]);
    expect(log).toEqual(artThenRestore);
    expect(stored["srd-2024_wolf"]?.source).toBe("default");
  });
});
