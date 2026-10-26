import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import type { SceneItem } from "../src/scene-model.js";
import { SHADOW_IDS, seedE2eTokenArt } from "./db.js";
import { e2eDir } from "./env.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

const INSTANCE_KEY = "com.ttrpg-agents/instance";

const shadowArt = {
  url: "https://cdn.owlbear.rodeo/e2e/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};
const direWolfArt = {
  url: "https://cdn.owlbear.rodeo/e2e/dire-wolf.png",
  mime: "image/png",
  width: 400,
  height: 200,
};

/** The bytes served for both images: a 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** This worker's bridge dir (same layout as the `bridge` fixture). */
const workerDir = () => join(e2eDir(), `worker-${test.info().workerIndex}`);

/** Our token for the instance with this id. */
function tokenOf(items: SceneItem[], instanceId: string): SceneItem {
  const found = items.find(
    (i) =>
      (i.metadata[INSTANCE_KEY] as { instanceId?: string } | undefined)
        ?.instanceId === instanceId,
  );
  if (!found) throw new Error(`no token for ${instanceId}`);
  return found;
}

const syncError = (page: Page) =>
  page.frameLocator("#extension").locator("#sync-error");

test.describe("changing a monster's type", () => {
  test.beforeEach(async ({ page }) => {
    // Both images answer, as the Owlbear CDN would.
    for (const url of [shadowArt.url, direWolfArt.url])
      await page.route(url, (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: PNG,
        }),
      );
  });

  test("a monster changed through the store is renamed and its image token is redrawn with the new type's art at the new footprint, in place", async ({
    page,
    bridge,
  }) => {
    seedE2eTokenArt(workerDir(), "shadow", shadowArt, PNG);
    seedE2eTokenArt(workerDir(), "dire-wolf", direWolfArt, PNG);
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    await expect
      .poll(async () => tokenOf(await readItems(page), SHADOW_IDS[0]!).type)
      .toBe("IMAGE");
    const before = await readItems(page);
    const token = tokenOf(before, SHADOW_IDS[0]!);

    const db = openDatabase(bridge.dbPath);
    const repo = new SqliteEncounterRepository(db);
    const instance = repo.listInstances().find((i) => i.id === SHADOW_IDS[0]);
    if (!instance) throw new Error("seeded shadow missing");
    let changed = false;
    try {
      // The bridge's change-log poll pushes an event after this commit.
      repo.changeMonsters(
        [
          {
            id: instance.id,
            monsterKey: "dire-wolf",
            displayName: "Dire Wolf 1",
            maxHp: 37,
            currentHp: 37,
            armorClass: 14,
            initiative: instance.initiative,
            footprint: 2,
          },
        ],
        origin,
      );
      changed = true;

      await expect
        .poll(async () => tokenOf(await readItems(page), SHADOW_IDS[0]!).name)
        .toBe("Dire Wolf 1");
      await expect
        .poll(async () => tokenOf(await readItems(page), SHADOW_IDS[0]!).image)
        .toEqual(direWolfArt);
      const after = await readItems(page);
      expect(tokenOf(after, SHADOW_IDS[0]!)).toMatchObject({
        id: token.id,
        type: "IMAGE",
        image: direWolfArt,
        // Two cells, image centred.
        grid: { dpi: 200, offset: { x: 200, y: 100 } },
        scale: { x: 1, y: 1 },
        position: token.position,
        visible: token.visible,
      });
      expect(after).toHaveLength(5);
      for (const id of SHADOW_IDS.slice(1))
        expect(tokenOf(after, id)).toMatchObject({
          image: shadowArt,
          grid: { dpi: 300, offset: { x: 150, y: 140 } },
        });
      await expect(syncError(page)).toHaveText("");
    } finally {
      try {
        // Put the seeded shadow back as it was, for the next test.
        if (changed)
          db.prepare(
            `UPDATE monster_instances
             SET monster_key = ?, display_name = ?, max_hp = ?, current_hp = ?,
                 armor_class = ?, initiative = ?, footprint = ?
             WHERE id = ?`,
          ).run(
            instance.monsterKey,
            instance.displayName,
            instance.maxHp,
            instance.currentHp,
            instance.armorClass,
            instance.initiative,
            instance.footprint,
            instance.id,
          );
      } finally {
        db.close();
      }
    }
  });
});
