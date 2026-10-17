import { test, expect, openDriver } from "./fixtures.js";

test.describe("scene writes through the real adapter", () => {
  test("addHiddenToken creates an item with visible: false", async ({
    page,
  }) => {
    const driver = await openDriver(page);
    await driver.evaluate(() =>
      window.__e2e!.addHiddenToken({
        id: "goblin-1",
        name: "Goblin",
        position: { x: 10, y: 20 },
      }),
    );
    const items = await page.evaluate(() => window.__host!.scene.getItems());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "goblin-1",
      name: "Goblin",
      visible: false,
      position: { x: 10, y: 20 },
    });
  });

  test("initiative metadata is written and other metadata survives", async ({
    page,
  }) => {
    const driver = await openDriver(page);
    await page.evaluate(() =>
      window.__host!.scene.setMetadata({ "other.ext/metadata": { keep: 1 } }),
    );
    await driver.evaluate(() =>
      window.__e2e!.writeInitiativeMetadata({ round: 2 }),
    );
    const metadata = await page.evaluate(() =>
      window.__host!.scene.getMetadata(),
    );
    expect(metadata).toEqual({
      "other.ext/metadata": { keep: 1 },
      "rodeo.owlbear.initiative-tracker/metadata": { round: 2 },
    });
  });

  test("an unhandled message id gets a clear error and is recorded", async ({
    page,
    hostErrors,
  }) => {
    // The fixture normally fails a test on any host error; opt in here.
    hostErrors.allow = true;
    const driver = await openDriver(page);
    const reply = await driver.evaluate(() =>
      window.__e2e!.sendRaw("OBR_NOPE"),
    );
    expect(reply.id).toMatch(/^OBR_NOPE_ERROR/);
    expect(reply.data).toMatchObject({
      message: expect.stringContaining('Unhandled Owlbear message "OBR_NOPE"'),
    });
    const errors = await page.evaluate(() => window.__host!.errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Unhandled Owlbear message "OBR_NOPE"');
  });

  test("getItems, updateItems and deleteItems reach the host", async ({
    page,
  }) => {
    const driver = await openDriver(page);
    await driver.evaluate(async () => {
      await window.__e2e!.addHiddenToken({
        id: "orc-1",
        name: "Orc",
        position: { x: 0, y: 0 },
      });
      await window.__e2e!.obr.updateItems(["orc-1"], {
        name: "Orc Chief",
        visible: true,
      });
    });
    const items = await page.evaluate(() => window.__host!.scene.getItems());
    expect(items[0]).toMatchObject({ name: "Orc Chief", visible: true });
    const seen = await driver.evaluate(() => window.__e2e!.obr.getItems());
    expect(seen.map((i) => i.name)).toEqual(["Orc Chief"]);

    await driver.evaluate(() => window.__e2e!.obr.deleteItems(["orc-1"]));
    expect(await page.evaluate(() => window.__host!.scene.getItems())).toEqual(
      [],
    );
  });

  test("a message with an unknown ref is rejected and recorded", async ({
    page,
    hostErrors,
  }) => {
    hostErrors.allow = true;
    const driver = await openDriver(page);
    await driver.evaluate(() => {
      window.parent.postMessage(
        { id: "OBR_SCENE_IS_READY", data: {}, ref: "forged", nonce: "_x" },
        location.origin,
      );
    });
    await expect
      .poll(() => page.evaluate(() => window.__host!.errors.join("|")))
      .toContain("unknown ref");
  });

  test.describe("fixture guard", () => {
    // Expected to fail: proves the auto fixture turns an unhandled message
    // into a test failure when the test does not opt in.
    test.fail();
    test("a test that triggers an unhandled id fails by default", async ({
      page,
    }) => {
      const driver = await openDriver(page);
      await driver.evaluate(() => window.__e2e!.sendRaw("OBR_NOPE"));
    });
  });
});
