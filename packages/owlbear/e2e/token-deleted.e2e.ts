import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { SHADOW_IDS, e2eDbPath, listE2eInstanceIds } from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";

const INSTANCE_KEY = "com.ttrpg-agents/instance";
const PLACED_KEY = "com.ttrpg-agents/placed";

const readItems = (page: Page) =>
  page.evaluate(() => window.__host!.scene.getItems());

/** This worker's bridge dir (same layout as the `bridge` fixture). */
const workerDir = () => join(e2eDir(), `worker-${test.info().workerIndex}`);

const storedIds = () => listE2eInstanceIds(workerDir()).sort();

/**
 * Puts the 5 seeded shadows back in place. The worker's bridge (and its DB)
 * outlives this spec, and other specs expect all 5.
 */
function restoreSeed(dir: string): void {
  if (listE2eInstanceIds(dir).length === SHADOW_IDS.length) return;
  const db = openDatabase(e2eDbPath(dir));
  try {
    const ids = [...SHADOW_IDS];
    const repo = new SqliteEncounterRepository(db, {
      newId: () => ids.shift()!,
    });
    repo.clearEncounter();
    repo.addInstances(() =>
      SHADOW_IDS.map((_, i) => ({
        monsterKey: "shadow",
        displayName: `Shadow ${i + 1}`,
        maxHp: 16,
      })),
    );
  } finally {
    db.close();
  }
}

async function deleteToken(page: Page, name: string): Promise<string> {
  const item = (await readItems(page)).find((i) => i.name === name)!;
  await page.evaluate((id) => window.__host!.scene.deleteItems([id]), item.id);
  return (item.metadata[INSTANCE_KEY] as { instanceId: string }).instanceId;
}

test.describe("deleting a token on the table", () => {
  test.afterEach(() => restoreSeed(workerDir()));

  test("deleting a token on the table removes the instance from the SQLite store and the token stays gone", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const tokenId = (await readItems(page)).find(
      (i) => i.name === "Shadow 2",
    )!.id;

    const instanceId = await deleteToken(page, "Shadow 2");

    await expect
      .poll(storedIds)
      .toEqual(SHADOW_IDS.filter((id) => id !== instanceId).sort());
    await page.waitForTimeout(500);
    const after = await readItems(page);
    expect(after).toHaveLength(4);
    expect(after.some((i) => i.id === tokenId)).toBe(false);
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });

  test("a scene that goes not ready, loses its items and its placed metadata, and becomes ready removes nothing from the store", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    // Switch scenes: the old one stops being ready and takes its tokens and
    // placed record with it; the new one becomes ready.
    await page.evaluate(() => window.__host!.scene.setReady(false));
    await page.waitForTimeout(300);
    await page.evaluate((key) => {
      const scene = window.__host!.scene;
      scene.deleteItems(scene.getItems().map((i) => i.id));
      scene.setMetadata({ [key]: undefined });
    }, PLACED_KEY);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__host!.scene.setReady(true));

    // The new scene is populated and the store keeps all 5.
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    await page.waitForTimeout(500);
    expect(storedIds()).toEqual([...SHADOW_IDS].sort());

    // Control: a deletion on the new scene is honoured.
    const instanceId = await deleteToken(page, "Shadow 4");
    await expect
      .poll(storedIds)
      .toEqual(SHADOW_IDS.filter((id) => id !== instanceId).sort());
  });
});
