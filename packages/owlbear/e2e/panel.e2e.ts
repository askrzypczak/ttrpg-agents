import { test, expect, openHarness } from "./fixtures.js";

test.describe("panel", () => {
  test("GM sees the bridge connection and scene readiness", async ({
    page,
  }) => {
    await openHarness(page, { role: "gm", ready: false });
    const panel = page.frameLocator("#extension");
    await expect(panel.locator("#status")).toHaveText(
      "Connected to the local bridge.",
    );
    await expect(panel.locator("#scene")).toHaveText("Waiting for scene...");

    await page.evaluate(() => window.__host?.scene.setReady(true));
    await expect(panel.locator("#scene")).toHaveText("Scene ready.");
  });

  test("without a token the panel asks to reinstall", async ({ page }) => {
    await openHarness(page, { token: null });
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "Token missing: reinstall via the URL the bridge printed.",
    );
  });

  test("player sees the GM-only message", async ({ page }) => {
    await openHarness(page, { role: "player" });
    await expect(page.frameLocator("#extension").locator("#status")).toHaveText(
      "This extension is only available to the GM.",
    );
  });

  test("the SDK ignores a host whose origin does not match obrref", async ({
    page,
  }) => {
    await openHarness(page, { obrOrigin: "http://example.invalid" });
    const status = page.frameLocator("#extension").locator("#status");
    await expect(status).toHaveText("Starting...");
    await page.waitForTimeout(500);
    await expect(status).toHaveText("Starting...");
  });
});
