import { join } from "node:path";
import type { Page } from "@playwright/test";
import { readE2eTokenArt, readE2eTokenImage } from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems, whileExtensionAway } from "./helpers.js";

const PLACED_KEY = "com.ttrpg-agents/placed";

/** What the Owlbear asset picker returns for one picked image (SDK `ImageDownload`, without its text label). */
const shadowDownload = {
  name: "Shadow",
  image: {
    url: "https://cdn.owlbear.rodeo/e2e/shadow.png",
    mime: "image/png",
    width: 300,
    height: 280,
  },
  // The SDK returns its own grid; the extension ignores it.
  grid: { dpi: 96, offset: { x: 10, y: 20 } },
  visible: true,
  locked: false,
  rotation: 0,
  scale: { x: 1, y: 1 },
  type: "CHARACTER",
};

/** The bytes served for the picked image: a 1x1 PNG. */
const SHADOW_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** This worker's bridge dir (same layout as the `bridge` fixture). */
const workerDir = () => join(e2eDir(), `worker-${test.info().workerIndex}`);

const storedShadowArt = () => readE2eTokenArt(workerDir()).shadow;

const pickerOpens = (page: Page) =>
  page.evaluate(() => window.__host!.imageRequests.length);

const syncError = (page: Page) =>
  page.frameLocator("#extension").locator("#sync-error");

async function expectShadowArtTokens(page: Page): Promise<void> {
  await expect.poll(async () => (await readItems(page)).length).toBe(5);
  for (const item of await readItems(page))
    expect(item).toMatchObject({
      type: "IMAGE",
      visible: false,
      image: shadowDownload.image,
      // One cell, image centred: derived from the image size, not the picked grid.
      grid: { dpi: 300, offset: { x: 150, y: 140 } },
    });
}

test.describe("token art from the Owlbear asset library", () => {
  // The picked image's url answers with real PNG bytes, as the Owlbear CDN would.
  test.beforeEach(async ({ page }) => {
    await page.route(shadowDownload.image.url, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: SHADOW_PNG,
      }),
    );
  });

  test("the picker opens once and the token shows the art", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm", pickedImages: [shadowDownload] });

    await expectShadowArtTokens(page);
    await page.waitForTimeout(500);
    expect(await pickerOpens(page)).toBe(1);
    await expect(syncError(page)).toHaveText("");
  });

  test("a reloaded extension does not prompt again and uses the stored art", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm", pickedImages: [shadowDownload] });
    await expectShadowArtTokens(page);
    expect(await pickerOpens(page)).toBe(1);

    // While the extension is away, the GM clears the scene (tokens and the
    // placed record), so it creates all 5 tokens again when it comes back.
    await whileExtensionAway(page, async () => {
      await page.evaluate((key) => {
        const scene = window.__host!.scene;
        scene.deleteItems(scene.getItems().map((i) => i.id));
        scene.setMetadata({ [key]: undefined });
      }, PLACED_KEY);
    });

    await expectShadowArtTokens(page);
    await page.waitForTimeout(500);
    expect(await pickerOpens(page)).toBe(1);
    await expect(syncError(page)).toHaveText("");
  });

  test("cancelling the picker leaves the hidden circle and no panel error", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });

    await expect.poll(() => pickerOpens(page)).toBe(1);
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "SHAPE", visible: false });
    await page.waitForTimeout(500);
    expect(await pickerOpens(page)).toBe(1);
    await expect(syncError(page)).toHaveText("");
  });

  test("after a pick the image bytes are stored and the art row refers to them", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm", pickedImages: [shadowDownload] });
    await expectShadowArtTokens(page);

    await expect
      .poll(() => storedShadowArt()?.sha256, { timeout: 10_000 })
      .toMatch(/^[0-9a-f]{64}$/);
    const art = storedShadowArt()!;
    expect(art).toMatchObject({ url: shadowDownload.image.url });
    const image = readE2eTokenImage(workerDir(), art.sha256!);
    expect(image?.mime).toBe("image/png");
    expect(Buffer.from(image?.bytes ?? [])).toEqual(SHADOW_PNG);
    await expect(syncError(page)).toHaveText("");
  });

  test("a failed image fetch keeps the art as a link and shows the failure in the panel", async ({
    page,
  }) => {
    await page.unroute(shadowDownload.image.url);
    await page.route(shadowDownload.image.url, (route) =>
      route.fulfill({
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "not found",
      }),
    );
    await openHarness(page, { role: "gm", pickedImages: [shadowDownload] });

    await expectShadowArtTokens(page);
    await expect(syncError(page)).toContainText(
      "Could not store the image of the token art for shadow; it is kept as a link",
    );
    await expect
      .poll(() => storedShadowArt()?.url)
      .toBe(shadowDownload.image.url);
    await page.waitForTimeout(500);
    expect(storedShadowArt()?.sha256).toBeUndefined();
  });
});
