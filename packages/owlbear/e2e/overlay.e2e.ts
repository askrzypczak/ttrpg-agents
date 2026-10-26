import { join } from "node:path";
import type { MapRegistration, SavedRoom } from "@ttrpg-agents/engine";
import type { SceneItem } from "../src/scene-model.js";
import { clearE2eMap, seedE2eMap } from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

const OVERLAY_KEY = "com.ttrpg-agents/overlay";

/** This worker's bridge dir (same layout as the `bridge` fixture). */
const workerDir = () => join(e2eDir(), `worker-${test.info().workerIndex}`);

/** Trollskull Manor as registered: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const registration: MapRegistration = {
  itemId: "e2e-trollskull",
  name: "Trollskull Manor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 270,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 3000,
    imageHeight: 4000,
    imageDpi: 125,
    sceneDpi: 150,
  },
};

/** The map image on the scene, where it was registered. */
const mapItem: SceneItem = {
  id: registration.itemId,
  type: "IMAGE",
  name: registration.name,
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
  layer: "MAP",
  rotation: 270,
  scale: { x: 1, y: 1 },
  image: {
    url: "https://example.test/trollskull.webp",
    mime: "image/webp",
    width: 3000,
    height: 4000,
  },
  grid: { dpi: 125, offset: { x: 0, y: 0 } },
};

/** T5:AB11 in image px. */
const taproom: SavedRoom = {
  name: "Taproom",
  status: "confirmed",
  polygons: [
    [
      { x: 1625, y: 2375 },
      { x: 2500, y: 2375 },
      { x: 2500, y: 3500 },
      { x: 1625, y: 3500 },
    ],
  ],
};

const hasOverlayKey = (item: SceneItem) =>
  item.metadata[OVERLAY_KEY] !== undefined;

test.describe("map overlay", () => {
  test("the overlay reaches the table as local items through the real adapter, and the panel toggle removes it", async ({
    page,
  }) => {
    seedE2eMap(workerDir(), registration, [taproom]);
    try {
      await openHarness(page, { role: "gm" });
      await page.evaluate(
        (item) => window.__host!.scene.addItems([item]),
        mapItem,
      );
      const readLocal = () =>
        page.evaluate(() => window.__host!.local.getItems());

      await expect
        .poll(async () => (await readLocal()).filter(hasOverlayKey).length)
        .toBeGreaterThan(0);
      // Let the first draw finish before reading it.
      await page.waitForTimeout(500);
      const local = (await readLocal()).filter(hasOverlayKey);
      const types = new Set(local.map((item) => item.type));
      expect(types).toEqual(new Set(["TEXT", "LINE", "CURVE"]));
      expect(
        local.some(
          (item) =>
            item.type === "TEXT" &&
            (item.text as { plainText?: string } | undefined)?.plainText ===
              "Taproom",
        ),
      ).toBe(true);
      expect((await readItems(page)).filter(hasOverlayKey)).toEqual([]);

      const toggle = page.frameLocator("#extension").locator("#overlay-toggle");
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect
        .poll(async () => (await readLocal()).filter(hasOverlayKey).length)
        .toBe(0);
      expect((await readItems(page)).filter(hasOverlayKey)).toEqual([]);
    } finally {
      clearE2eMap(workerDir());
    }
  });
});
