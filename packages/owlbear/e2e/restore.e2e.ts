import type { Page } from "@playwright/test";
import type { ChangeOrigin, MonsterInstance } from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { dirname } from "node:path";
import type { SceneItem } from "../src/scene-model.js";
import { SHADOW_IDS, seedE2eTokenArt } from "./db.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

const removeOrigin: ChangeOrigin = { source: "mcp", commandId: "remove" };
const restoreOrigin: ChangeOrigin = { source: "mcp", commandId: "restore" };
const clearOrigin: ChangeOrigin = { source: "mcp", commandId: "clear" };

const INSTANCE_KEY = "com.ttrpg-agents/instance";
const PLACED_KEY = "com.ttrpg-agents/placed";

const keepName = (i: MonsterInstance): string => i.displayName;

/** A 1x1 PNG, as stored token art bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const instanceIdOf = (item: SceneItem): string | undefined =>
  (item.metadata[INSTANCE_KEY] as { instanceId?: string } | undefined)
    ?.instanceId;

const tokensFor = (items: SceneItem[], instanceId: string): SceneItem[] =>
  items.filter((i) => instanceIdOf(i) === instanceId);

/** Whether the scene's placed record still mentions the instance. */
async function placedMentions(
  page: Page,
  instanceId: string,
): Promise<boolean> {
  const placed = await page.evaluate(
    (key) => window.__host!.scene.getMetadata()[key],
    PLACED_KEY,
  );
  return JSON.stringify(placed ?? null).includes(instanceId);
}

/** Runs `use` with a repository on the bridge's database, closing it after. */
async function withRepo<T>(
  dbPath: string,
  use: (repo: SqliteEncounterRepository) => T | Promise<T>,
): Promise<T> {
  const db = openDatabase(dbPath);
  try {
    return await use(new SqliteEncounterRepository(db));
  } finally {
    db.close();
  }
}

const storedIds = (dbPath: string): Promise<string[]> =>
  withRepo(dbPath, (repo) =>
    repo
      .listInstances()
      .map((i) => i.id)
      .sort(),
  );

test.describe("restoring a removed monster", () => {
  test("a monster removed through the store loses its token and gets it back with its name when restored", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const id = SHADOW_IDS[1]!;

    await withRepo(bridge.dbPath, (repo) =>
      repo.removeInstances([id], removeOrigin),
    );
    await expect.poll(async () => (await readItems(page)).length).toBe(4);
    expect(tokensFor(await readItems(page), id)).toEqual([]);

    await withRepo(bridge.dbPath, (repo) =>
      repo.restoreInstances([id], keepName, restoreOrigin),
    );

    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const back = tokensFor(await readItems(page), id);
    expect(back.map((i) => i.name)).toEqual(["Shadow 2"]);
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });

  test("a token the GM deleted on the table comes back when its monster is restored", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const token = (await readItems(page)).find((i) => i.name === "Shadow 2")!;
    const id = instanceIdOf(token)!;

    await page.evaluate(
      (itemId) => window.__host!.scene.deleteItems([itemId]),
      token.id,
    );
    await expect
      .poll(() => storedIds(bridge.dbPath))
      .toEqual(SHADOW_IDS.filter((s) => s !== id).sort());
    await expect.poll(() => placedMentions(page, id)).toBe(false);

    await withRepo(bridge.dbPath, (repo) =>
      repo.restoreInstances([id], keepName, restoreOrigin),
    );

    await expect
      .poll(async () => tokensFor(await readItems(page), id).length)
      .toBe(1);
    expect(tokensFor(await readItems(page), id)[0]?.name).toBe("Shadow 2");
    // The new token must not be taken for a deletion and removed again.
    await page.waitForTimeout(500);
    expect(await readItems(page)).toHaveLength(5);
    expect(await storedIds(bridge.dbPath)).toEqual([...SHADOW_IDS].sort());
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });
});

test.describe("restoring a cleared encounter", () => {
  test("a cleared encounter loses its tokens and gets them back with their names when restored", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    await withRepo(bridge.dbPath, (repo) => repo.clearEncounter(clearOrigin));
    await expect.poll(async () => (await readItems(page)).length).toBe(0);

    const clearedIds = await withRepo(bridge.dbPath, (repo) =>
      repo
        .listRemovedInstances()
        .filter((r) => r.cleared)
        .map((r) => r.instance.id),
    );
    expect([...clearedIds].sort()).toEqual([...SHADOW_IDS].sort());
    await withRepo(bridge.dbPath, (repo) =>
      repo.restoreInstances(clearedIds, keepName, restoreOrigin),
    );

    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const items = await readItems(page);
    expect(
      SHADOW_IDS.map((id) => tokensFor(items, id).map((i) => i.name)),
    ).toEqual([
      ["Shadow 1"],
      ["Shadow 2"],
      ["Shadow 3"],
      ["Shadow 4"],
      ["Shadow 5"],
    ]);
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });

  test("after a clear and a restore, with one type without art and one whose art is gone, cancelling the picker places every token at once and scene-status reports the re-upload and no pick", async ({
    page,
    bridge,
  }) => {
    // The shadows' stored art is gone from the library; the wolves have none.
    const storedImage = {
      url: "https://cdn.owlbear.rodeo/e2e/shadow-old.png",
      mime: "image/png",
      width: 1,
      height: 1,
    };
    seedE2eTokenArt(dirname(bridge.dbPath), "shadow", storedImage, PNG);
    // The CDN's answer for an asset deleted from the library.
    await page.route(storedImage.url, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json; charset=utf-8",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          statusCode: "404",
          error: "not_found",
          message: "Object not found",
          code: "NoSuchKey",
        }),
      }),
    );
    await withRepo(bridge.dbPath, (repo) => {
      repo.addInstances(
        () => [
          { monsterKey: "wolf", displayName: "Wolf 1", maxHp: 11 },
          { monsterKey: "wolf", displayName: "Wolf 2", maxHp: 11 },
        ],
        clearOrigin,
      );
      repo.clearEncounter(clearOrigin);
    });
    // The picker answers nothing: the GM cancels it.
    await openHarness(page, { role: "gm" });
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );
    expect(await readItems(page)).toEqual([]);

    const clearedIds = await withRepo(bridge.dbPath, (repo) =>
      repo
        .listRemovedInstances()
        .filter((r) => r.cleared)
        .map((r) => r.instance.id),
    );
    expect(clearedIds).toHaveLength(7);
    await withRepo(bridge.dbPath, (repo) =>
      repo.restoreInstances(clearedIds, keepName, restoreOrigin),
    );

    await expect.poll(async () => (await readItems(page)).length).toBe(7);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "SHAPE" });
    // One picker, for the wolves; no upload dialog for the shadows.
    expect(await page.evaluate(() => window.__host!.imageRequests.length)).toBe(
      1,
    );
    expect(await page.evaluate(() => window.__host!.uploads)).toEqual([]);

    const sceneStatus = async () => {
      const res = await fetch(`${bridge.origin}/agent/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "scene-status" }),
      });
      return (await res.json()) as unknown;
    };
    await expect.poll(sceneStatus).toEqual({
      ok: true,
      result: {
        name: "scene-status",
        result: {
          sceneReady: true,
          tokenCount: 7,
          appliedInstanceCount: 7,
          artWaits: [
            { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
          ],
        },
      },
    });
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });
});
