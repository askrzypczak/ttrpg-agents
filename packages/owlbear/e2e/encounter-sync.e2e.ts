import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { SceneItem } from "../src/scene-model.js";
import { SHADOW_IDS } from "./db.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

const INSTANCE_KEY = "com.ttrpg-agents/instance";
const INITIATIVE_KEY = "rodeo.owlbear.initiative-tracker/metadata";

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

const nameOf = (items: SceneItem[], instanceId: string): string =>
  tokenOf(items, instanceId).name;

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

  test("synced tokens carry the group initiative metadata", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    const items = await readItems(page);
    for (const id of SHADOW_IDS)
      expect(tokenOf(items, id).metadata[INITIATIVE_KEY]).toEqual({
        count: "14",
        active: false,
      });
  });

  test("a second snapshot only adds what is missing", async ({ page }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const before = await readItems(page);

    // The harness (and its scene) outlives the extension iframe. The GM
    // deletes one token, then only the iframe reloads: the extension
    // reconnects and the bridge sends a fresh snapshot into a scene that
    // holds 4 of 5.
    const removed = before.find((i) => i.name === "Shadow 3")!;
    await page.evaluate(
      (id) => window.__host!.scene.deleteItems([id]),
      removed.id,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const iframe = document.getElementById(
            "extension",
          ) as HTMLIFrameElement;
          iframe.addEventListener("load", () => resolve(), { once: true });
          const url = new URL(iframe.src);
          url.searchParams.set("reload", "1");
          iframe.src = url.href + location.hash;
        }),
    );
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );

    // Deletion sticks: the deleted token is not re-created and the other 4
    // are neither duplicated nor moved.
    await page.waitForTimeout(500);
    const after = await readItems(page);
    expect(after).toHaveLength(4);
    expect(after.some((i) => i.id === removed.id)).toBe(false);
    expect(new Set(after.map((i) => i.id)).size).toBe(4);
    for (const item of before.filter((i) => i.id !== removed.id))
      expect(after.find((i) => i.id === item.id)?.position).toEqual(
        item.position,
      );
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });

  test("a player does not connect and gets no tokens", async ({ page }) => {
    await openHarness(page, { role: "player" });
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "This extension is only available to the GM.",
    );
    await page.waitForTimeout(500);
    expect(await readItems(page)).toEqual([]);
  });

  test("a snapshot that beats the scene is applied once it is ready", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm", ready: false });
    const frame = page.frameLocator("#extension");
    await expect(frame.locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );
    await page.waitForTimeout(500);
    expect(await readItems(page)).toEqual([]);
    await expect(frame.locator("#sync-error")).toHaveText("");

    await page.evaluate(() => window.__host!.scene.setReady(true));
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    await page.waitForTimeout(500);
    const items = await readItems(page);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
    await expect(frame.locator("#sync-error")).toHaveText("");
  });

  test("a monster renamed through the store is renamed on its token, the other tokens keep their names and none is added", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const before = await readItems(page);

    const db = openDatabase(bridge.dbPath);
    const repo = new SqliteEncounterRepository(db);
    let renamed = false;
    try {
      // The bridge's data_version poll pushes a snapshot after this commit.
      repo.renameInstance(SHADOW_IDS[1]!, "Boss");
      renamed = true;
      await expect
        .poll(async () => nameOf(await readItems(page), SHADOW_IDS[1]!))
        .toBe("Boss");

      await page.waitForTimeout(500);
      const after = await readItems(page);
      expect(after).toHaveLength(5);
      expect(new Set(after.map((i) => i.id))).toEqual(
        new Set(before.map((i) => i.id)),
      );
      expect(SHADOW_IDS.map((id) => nameOf(after, id))).toEqual([
        "Shadow 1",
        "Boss",
        "Shadow 3",
        "Shadow 4",
        "Shadow 5",
      ]);
      await expect(
        page.frameLocator("#extension").locator("#sync-error"),
      ).toHaveText("");
    } finally {
      try {
        if (renamed) repo.renameInstance(SHADOW_IDS[1]!, "Shadow 2");
      } finally {
        db.close();
      }
    }
  });

  test("a token the GM renamed on the table keeps its name across an unrelated store change", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);
    const gmToken = tokenOf(await readItems(page), SHADOW_IDS[0]!);
    await page.evaluate(
      (id) => window.__host!.scene.updateItems([id], { name: "Boss" }),
      gmToken.id,
    );

    const db = openDatabase(bridge.dbPath);
    const repo = new SqliteEncounterRepository(db);
    let damaged = false;
    let renamed = false;
    try {
      // Unrelated to the token's name: its monster takes damage, and another
      // monster is renamed, whose token shows when the snapshot has landed.
      repo.applyDamage(SHADOW_IDS[0]!, 3);
      damaged = true;
      repo.renameInstance(SHADOW_IDS[2]!, "Ghost");
      renamed = true;
      await expect
        .poll(async () => nameOf(await readItems(page), SHADOW_IDS[2]!))
        .toBe("Ghost");

      const after = await readItems(page);
      expect(after).toHaveLength(5);
      expect(nameOf(after, SHADOW_IDS[0]!)).toBe("Boss");
      await expect(
        page.frameLocator("#extension").locator("#sync-error"),
      ).toHaveText("");
    } finally {
      try {
        if (renamed) repo.renameInstance(SHADOW_IDS[2]!, "Shadow 3");
        if (damaged) repo.applyHealing(SHADOW_IDS[0]!, 3);
      } finally {
        db.close();
      }
    }
  });

  test("a sync failure is shown in the panel", async ({ page }) => {
    await openHarness(page, { role: "gm", failItems: "items are broken" });
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("Encounter sync failed: Error: items are broken");
    expect(await readItems(page)).toEqual([]);
  });
});
