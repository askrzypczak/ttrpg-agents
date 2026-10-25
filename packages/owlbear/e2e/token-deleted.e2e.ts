import { join } from "node:path";
import type { Page } from "@playwright/test";
import { SHADOW_IDS, listE2eInstanceIds } from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";
import {
  controlBridgeSocket,
  readItems,
  whileExtensionAway,
} from "./helpers.js";

const INSTANCE_KEY = "com.ttrpg-agents/instance";
const PLACED_KEY = "com.ttrpg-agents/placed";

/** This worker's bridge dir (same layout as the `bridge` fixture). */
const workerDir = () => join(e2eDir(), `worker-${test.info().workerIndex}`);

const storedIds = () => listE2eInstanceIds(workerDir()).sort();

async function deleteToken(page: Page, name: string): Promise<string> {
  const item = (await readItems(page)).find((i) => i.name === name)!;
  await page.evaluate((id) => window.__host!.scene.deleteItems([id]), item.id);
  return (item.metadata[INSTANCE_KEY] as { instanceId: string }).instanceId;
}

test.describe("deleting a token on the table", () => {
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

  test("a token deleted while the extension is away is removed from the store when it reconnects, and not recreated", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const tokenId = (await readItems(page)).find(
      (i) => i.name === "Shadow 4",
    )!.id;

    let instanceId = "";
    await whileExtensionAway(page, async () => {
      // Nobody is listening: the deletion changes the scene, not the store.
      instanceId = await deleteToken(page, "Shadow 4");
      await page.waitForTimeout(500);
      expect(storedIds()).toEqual([...SHADOW_IDS].sort());
    });
    // The extension came back, saw the token missing and reported it.

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

  test("a token deleted while the bridge socket is down is removed from the store once after the reconnect", async ({
    page,
  }) => {
    const socket = await controlBridgeSocket(page);
    await openHarness(page, { role: "gm" });
    const panel = page.frameLocator("#extension");
    await expect(panel.locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    await socket.drop();
    await expect(panel.locator("#status")).not.toHaveText(
      "Connected to the local bridge.",
    );
    const instanceId = await deleteToken(page, "Shadow 2");

    // The command waits in the extension: the panel says so, the store is unchanged.
    await expect(panel.locator("#edit-note")).toHaveText(/1.*waiting/);
    expect(storedIds()).toEqual([...SHADOW_IDS].sort());

    socket.restore();
    await expect(panel.locator("#status")).toHaveText(
      "Connected to the local bridge.",
      { timeout: 20_000 },
    );
    await expect
      .poll(storedIds)
      .toEqual(SHADOW_IDS.filter((id) => id !== instanceId).sort());
    await expect(panel.locator("#edit-note")).toHaveText("");
    // A second removal would be refused as unknown and shown here.
    await page.waitForTimeout(500);
    await expect(panel.locator("#sync-error")).toHaveText("");
    expect(await readItems(page)).toHaveLength(4);
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
