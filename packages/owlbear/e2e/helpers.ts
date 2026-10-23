import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";

/** The items currently on the fake host's scene. */
export const readItems = (page: Page) =>
  page.evaluate(() => window.__host!.scene.getItems());

/**
 * Navigates the extension iframe away (its socket closes), runs `whileAway`,
 * then brings the extension back and waits until it is connected again.
 */
export async function whileExtensionAway(
  page: Page,
  whileAway: () => Promise<void>,
): Promise<void> {
  // The fake host posts to the iframe's origin, so go to a page on the same
  // origin rather than about:blank (origin null). Keep the extension's URL to
  // bring it back later.
  const extensionUrl = await page.evaluate(
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

  await whileAway();

  // Reloading the extension makes it reconnect and receive a fresh snapshot.
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
