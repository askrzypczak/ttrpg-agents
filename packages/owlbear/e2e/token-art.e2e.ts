import type { Page } from "@playwright/test";
import { test, expect, openHarness } from "./fixtures.js";

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

const readItems = (page: Page) =>
  page.evaluate(() => window.__host!.scene.getItems());

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

/** Navigates the extension iframe away; resolves with its URL to come back to. */
function leaveExtension(page: Page): Promise<string> {
  // The fake host posts to the iframe's origin, so stay on that origin.
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const iframe = document.getElementById(
          "extension",
        ) as HTMLIFrameElement;
        const url = iframe.src;
        iframe.addEventListener("load", () => resolve(url), { once: true });
        iframe.src = new URL("/away.html", url).href;
      }),
  );
}

async function reloadExtension(page: Page, extensionUrl: string) {
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        const iframe = document.getElementById(
          "extension",
        ) as HTMLIFrameElement;
        iframe.addEventListener("load", () => resolve(), { once: true });
        const url = new URL(src);
        url.searchParams.set("reload", "1");
        iframe.src = url.href + location.hash;
      }),
    extensionUrl,
  );
  await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
    "Connected to the local bridge.",
  );
}

test.describe("token art from the Owlbear asset library", () => {
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
    const extensionUrl = await leaveExtension(page);
    await page.evaluate((key) => {
      const scene = window.__host!.scene;
      scene.deleteItems(scene.getItems().map((i) => i.id));
      scene.setMetadata({ [key]: undefined });
    }, PLACED_KEY);
    await reloadExtension(page, extensionUrl);

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
});
