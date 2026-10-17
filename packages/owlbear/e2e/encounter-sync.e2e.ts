import { SHADOW_IDS } from "./db.js";
import { test, expect, openHarness } from "./fixtures.js";

const INSTANCE_KEY = "com.ttrpg-agents/instance";

const readItems = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__host!.scene.getItems());

test.describe("encounter -> hidden Owlbear tokens", () => {
  test("GM gets one hidden SHAPE token per instance, in a row", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    const items = await readItems(page);
    const sorted = [...items].sort((a, b) => a.position.x - b.position.x);
    expect(sorted.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
      "Shadow 4",
      "Shadow 5",
    ]);
    for (const [n, item] of sorted.entries()) {
      expect(item.type).toBe("SHAPE");
      expect(item.visible).toBe(false);
      expect(item.metadata[INSTANCE_KEY]).toEqual({
        instanceId: SHADOW_IDS[n],
      });
    }
    // One row: same y, distinct x.
    expect(new Set(items.map((i) => i.position.y)).size).toBe(1);
    expect(new Set(items.map((i) => i.position.x)).size).toBe(5);
  });

  test("a second snapshot only adds what is missing", async ({ page }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const before = await readItems(page);

    // The harness (and its scene) outlives the extension iframe. Drop one
    // token, then reload only the iframe: the extension reconnects and the
    // bridge sends a fresh snapshot into a scene that already holds 4 of 5.
    const removed = before.find((i) => i.name === "Shadow 3")!;
    await page.evaluate(
      (id) => window.__host!.scene.deleteItems([id]),
      removed.id,
    );
    await page.evaluate(() => {
      const iframe = document.getElementById("extension") as HTMLIFrameElement;
      const url = new URL(iframe.src);
      url.searchParams.set("reload", "1");
      iframe.src = url.href + location.hash;
    });

    // Back to 5 (the missing one re-created, the other 4 not duplicated).
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    await page.waitForTimeout(500);
    const after = await readItems(page);
    expect(after).toHaveLength(5);
    expect(new Set(after.map((i) => i.id)).size).toBe(5);
    for (const item of before.filter((i) => i.id !== removed.id))
      expect(after.find((i) => i.id === item.id)?.position).toEqual(
        item.position,
      );
  });

  test("a player does not connect and gets no tokens", async ({ page }) => {
    await openHarness(page, { role: "player" });
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "This extension is only available to the GM.",
    );
    await page.waitForTimeout(500);
    expect(await readItems(page)).toEqual([]);
  });
});
