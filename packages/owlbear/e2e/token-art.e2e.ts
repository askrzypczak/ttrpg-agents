import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import {
  SHADOW_IDS,
  e2eDbPath,
  readE2eTokenArt,
  readE2eTokenImage,
  seedE2eTokenArt,
} from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems, whileExtensionAway } from "./helpers.js";

const PLACED_KEY = "com.ttrpg-agents/placed";
const INSTANCE_KEY = "com.ttrpg-agents/instance";
const STAT_BUBBLES_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

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

/** The Stat Bubbles health on the token of the instance with this id. */
async function healthOf(page: Page, instanceId: string): Promise<number> {
  const token = (await readItems(page)).find(
    (i) =>
      (i.metadata[INSTANCE_KEY] as { instanceId?: string } | undefined)
        ?.instanceId === instanceId,
  );
  if (!token) throw new Error(`no token for ${instanceId}`);
  return (token.metadata[STAT_BUBBLES_KEY] as { health: number }).health;
}

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
    const failure =
      "Could not store the image of the token art for shadow; it is kept as a link";
    await expect(syncError(page)).toContainText(failure);
    await expect(syncError(page)).toContainText("HTTP 404");
    await expect
      .poll(() => storedShadowArt()?.url)
      .toBe(shadowDownload.image.url);
    await page.waitForTimeout(500);
    expect(storedShadowArt()?.sha256).toBeUndefined();

    // A store change reaches the table and leaves the failure shown.
    const db = openDatabase(e2eDbPath(workerDir()));
    try {
      new SqliteEncounterRepository(db).setHp(SHADOW_IDS[0]!, 7, origin);
      await expect.poll(() => healthOf(page, SHADOW_IDS[0]!)).toBe(7);
      await expect(syncError(page)).toContainText(failure);
    } finally {
      try {
        // The worker's DB outlives the test, and the seed keeps HP as is.
        new SqliteEncounterRepository(db).setHp(SHADOW_IDS[0]!, 16, origin);
      } finally {
        db.close();
      }
    }
  });
});

test.describe("stored token art whose Owlbear asset may be gone", () => {
  /** The stored art's url; each test decides whether it still answers. */
  const storedImage = {
    url: "https://cdn.owlbear.rodeo/e2e/shadow-old.png",
    mime: "image/png",
    width: 1,
    height: 1,
  };

  const uploads = (page: Page) => page.evaluate(() => window.__host!.uploads);

  const imageRequests = (page: Page) =>
    page.evaluate(() => window.__host!.imageRequests);

  /** The panel's re-upload row of a monster type. */
  const reuploadRow = (page: Page, monsterKey: string) =>
    page
      .frameLocator("#extension")
      .locator(`#reupload-list li[data-monster-key="${monsterKey}"]`);

  /** The stored url answers 404, as for an asset deleted from the library. */
  const storedUrlGone = (page: Page) =>
    page.route(storedImage.url, (route) =>
      route.fulfill({
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "not found",
      }),
    );

  async function expectShadowCircles(page: Page): Promise<void> {
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "SHAPE" });
  }

  test("a type whose art is gone is listed in the panel on connect with no Owlbear dialog", async ({
    page,
  }) => {
    seedE2eTokenArt(workerDir(), "shadow", storedImage, SHADOW_PNG);
    await storedUrlGone(page);
    await openHarness(page, { role: "gm" });

    const panel = page.frameLocator("#extension");
    await expect(panel.locator("#reupload")).toBeVisible();
    await expect(reuploadRow(page, "shadow")).toContainText("Shadow (1 of 1)");
    await expect(
      reuploadRow(page, "shadow").getByRole("button", { name: "Re-upload" }),
    ).toBeVisible();
    await expectShadowCircles(page);
    await page.waitForTimeout(500);
    expect(await uploads(page)).toEqual([]);
    expect(await pickerOpens(page)).toBe(0);
    await expect(syncError(page)).toHaveText("");
  });

  test("re-uploading from the panel, then picking the uploaded image, stores the art with the same hash and redraws the type's circles with it", async ({
    page,
  }) => {
    const sha256 = seedE2eTokenArt(
      workerDir(),
      "shadow",
      storedImage,
      SHADOW_PNG,
    );
    const name = `ttrpg-art-${sha256.slice(0, 16)}`;
    await storedUrlGone(page);
    // What the GM picks once the upload is in their library.
    const republishedDownload = {
      ...shadowDownload,
      name,
      image: {
        url: "https://cdn.owlbear.rodeo/e2e/republished.png",
        mime: "image/png",
        width: 1,
        height: 1,
      },
    };
    await openHarness(page, {
      role: "gm",
      pickedImages: [republishedDownload],
    });
    await expectShadowCircles(page);
    const row = reuploadRow(page, "shadow");

    await row.getByRole("button", { name: "Re-upload" }).click();

    await expect.poll(() => uploads(page)).toHaveLength(1);
    expect((await uploads(page))[0]).toEqual({
      name,
      typeHint: "CHARACTER",
      type: "image/png",
      size: SHADOW_PNG.length,
    });
    await expect(row).toContainText(name);
    expect(await pickerOpens(page)).toBe(0);

    await row.getByRole("button", { name: "Pick the uploaded image" }).click();

    await expect
      .poll(() => storedShadowArt()?.url)
      .toBe(republishedDownload.image.url);
    expect(storedShadowArt()).toEqual({
      ...republishedDownload.image,
      sha256,
    });
    const requests = await imageRequests(page);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ defaultSearch: name });
    // The circles are replaced with image tokens drawn with the pick.
    await expect
      .poll(async () =>
        (await readItems(page)).filter((item) => item.type === "IMAGE"),
      )
      .toHaveLength(5);
    const items = await readItems(page);
    expect(items).toHaveLength(5);
    for (const item of items)
      expect(item).toMatchObject({
        type: "IMAGE",
        image: republishedDownload.image,
      });
    const panel = page.frameLocator("#extension");
    await expect(panel.locator("#overrides-list")).toContainText(
      "Shadow 1's token was replaced with a new one drawn with the art uploaded for its monster type",
    );
    await expect(panel.locator("#reupload")).toBeHidden();
    expect(await uploads(page)).toHaveLength(1);
    await expect(syncError(page)).toHaveText("");
  });

  test("stored art without a url is listed in the panel, and re-uploading and picking it stores the picked url with the same hash", async ({
    page,
  }) => {
    const sha256 = seedE2eTokenArt(workerDir(), "shadow", null, SHADOW_PNG);
    expect(storedShadowArt()).toEqual({ sha256 });
    const name = `ttrpg-art-${sha256.slice(0, 16)}`;
    // What the GM picks once the upload is in their library.
    const uploadedDownload = {
      ...shadowDownload,
      name,
      image: {
        url: "https://cdn.owlbear.rodeo/e2e/uploaded.png",
        mime: "image/png",
        width: 1,
        height: 1,
      },
    };
    await openHarness(page, {
      role: "gm",
      pickedImages: [uploadedDownload],
    });
    await expectShadowCircles(page);
    const row = reuploadRow(page, "shadow");
    await expect(row).toContainText("Shadow (1 of 1)");
    expect(await uploads(page)).toEqual([]);
    expect(await pickerOpens(page)).toBe(0);

    await row.getByRole("button", { name: "Re-upload" }).click();
    await expect.poll(() => uploads(page)).toHaveLength(1);
    await row.getByRole("button", { name: "Pick the uploaded image" }).click();

    await expect
      .poll(() => storedShadowArt()?.url)
      .toBe(uploadedDownload.image.url);
    expect(storedShadowArt()).toEqual({ ...uploadedDownload.image, sha256 });
    await expect
      .poll(async () =>
        (await readItems(page)).filter((item) => item.type === "IMAGE"),
      )
      .toHaveLength(5);
    const requests = await imageRequests(page);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ defaultSearch: name });
    await expect(syncError(page)).toHaveText("");
  });

  test("stored art whose url is alive creates image tokens with no upload and no picker", async ({
    page,
  }) => {
    const sha256 = seedE2eTokenArt(
      workerDir(),
      "shadow",
      storedImage,
      SHADOW_PNG,
    );
    let checks = 0;
    await page.route(storedImage.url, (route) => {
      checks += 1;
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: SHADOW_PNG,
      });
    });
    await openHarness(page, { role: "gm" });

    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "IMAGE", image: storedImage });
    // The extension asked whether the stored url still answers.
    await expect.poll(() => checks).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await uploads(page)).toEqual([]);
    expect(await pickerOpens(page)).toBe(0);
    expect(storedShadowArt()).toEqual({ ...storedImage, sha256 });
    await expect(syncError(page)).toHaveText("");
  });

  test("stored art without stored bytes whose url is alive gets its bytes stored and the art row takes their hash, with no upload dialog and no picker", async ({
    page,
  }) => {
    // Link-only art: a url and no hash, as picked before bytes were stored.
    const db = openDatabase(e2eDbPath(workerDir()));
    try {
      new SqliteTokenArtRepository(db).setTokenArt("shadow", storedImage);
    } finally {
      db.close();
    }
    expect(storedShadowArt()).toEqual(storedImage);
    await page.route(storedImage.url, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: SHADOW_PNG,
      }),
    );
    await openHarness(page, { role: "gm" });

    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "IMAGE", image: storedImage });
    await expect
      .poll(() => storedShadowArt()?.sha256, { timeout: 10_000 })
      .toMatch(/^[0-9a-f]{64}$/);
    const sha256 = storedShadowArt()!.sha256!;
    expect(storedShadowArt()).toEqual({ ...storedImage, sha256 });
    const image = readE2eTokenImage(workerDir(), sha256);
    expect(image?.mime).toBe("image/png");
    expect(Buffer.from(image?.bytes ?? [])).toEqual(SHADOW_PNG);
    expect(await uploads(page)).toEqual([]);
    expect(await pickerOpens(page)).toBe(0);
    await expect(syncError(page)).toHaveText("");
  });

  test("stored bytes the bridge cannot serve show the failure in the panel when Re-upload is pressed, and leave the type listed with circle tokens", async ({
    page,
  }) => {
    const sha256 = seedE2eTokenArt(
      workerDir(),
      "shadow",
      storedImage,
      SHADOW_PNG,
    );
    await storedUrlGone(page);
    // Registered after the page fixture's route for the bridge origin, so it
    // answers the extension's read first.
    let reads = 0;
    await page.route(`**/token-images/${sha256}`, (route) => {
      reads += 1;
      return route.fulfill({
        status: 404,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "not_found",
            message: "no token image with that hash",
          },
        }),
      });
    });
    await openHarness(page, { role: "gm" });
    await expectShadowCircles(page);
    const row = reuploadRow(page, "shadow");
    await expect(row).toContainText("Shadow (1 of 1)");
    expect(reads).toBe(0);

    await row.getByRole("button", { name: "Re-upload" }).click();

    await expect(syncError(page)).toContainText(
      "Could not republish the token art for shadow",
    );
    expect(reads).toBe(1);
    await expect(row).toContainText("Shadow (1 of 1)");
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "SHAPE" });
    expect(await uploads(page)).toEqual([]);
    expect(await pickerOpens(page)).toBe(0);
    expect(storedShadowArt()).toEqual({ ...storedImage, sha256 });
  });
});

test.describe("art steps named in the panel", () => {
  test("the panel names the monster type and the step count while the fresh picker is open", async ({
    page,
    bridge,
  }) => {
    // An empty encounter, so no picker opens on connect.
    const db = openDatabase(bridge.dbPath);
    try {
      new SqliteEncounterRepository(db).clearEncounter(origin);
    } finally {
      db.close();
    }
    await openHarness(page, { role: "gm" });
    const panel = page.frameLocator("#extension");
    await expect(panel.locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );

    // Hold each picker answer until the test releases it, as a GM who has
    // not chosen yet.
    await page.evaluate(() => {
      type Reply = (
        message: { id: string },
        kind: string,
        data: unknown,
      ) => void;
      const host = window.__host as unknown as { reply: Reply };
      const reply = host.reply.bind(host);
      const held: (() => void)[] = [];
      (window as unknown as { __releasePick: () => void }).__releasePick = () =>
        held.shift()?.();
      host.reply = (message, kind, data) => {
        if (message.id === "OBR_ASSETS_DOWNLOAD_IMAGES")
          held.push(() => reply(message, kind, data));
        else reply(message, kind, data);
      };
    });
    const releasePick = () =>
      page.evaluate(() =>
        (window as unknown as { __releasePick: () => void }).__releasePick(),
      );

    // Two types with no art arrive in one change.
    const add = openDatabase(bridge.dbPath);
    try {
      new SqliteEncounterRepository(add).addInstances(
        () => [
          { monsterKey: "ogre", displayName: "Ogre 1", maxHp: 59 },
          { monsterKey: "wolf", displayName: "Wolf 1", maxHp: 11 },
        ],
        origin,
      );
    } finally {
      add.close();
    }

    const prompt = panel.locator("#art-prompt");
    await expect(prompt).toHaveText(
      "Art 1 of 2: choose the token art for Ogre in Owlbear's image picker, or cancel it to use circles.",
    );
    expect(await pickerOpens(page)).toBe(1);
    await releasePick();

    await expect(prompt).toHaveText(
      "Art 2 of 2: choose the token art for Wolf in Owlbear's image picker, or cancel it to use circles.",
    );
    expect(await pickerOpens(page)).toBe(2);
    await releasePick();

    await expect(prompt).toHaveText("");
    await expect.poll(async () => (await readItems(page)).length).toBe(2);
    for (const item of await readItems(page))
      expect(item).toMatchObject({ type: "SHAPE" });
    await expect(syncError(page)).toHaveText("");
  });
});
