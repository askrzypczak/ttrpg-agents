import type { Page, WebSocketRoute } from "@playwright/test";
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

/** Takes over the extension's WebSocket to the bridge so a test can drop it. */
export interface BridgeSocketControl {
  /**
   * Closes the open socket and, until `restore`, never connects a new one to
   * the bridge: the extension gets no hello-ack and keeps retrying.
   */
  drop(): Promise<void>;
  /** Lets the extension's next attempt through to the bridge. */
  restore(): void;
}

/** Call before the extension loads; its socket to the bridge's `/ws` is then routed through here. */
export async function controlBridgeSocket(
  page: Page,
): Promise<BridgeSocketControl> {
  let down = false;
  const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  await page.routeWebSocket(/\/ws$/, (route) => {
    // A mocked socket opens, but nobody answers its hello.
    if (down) return;
    const pair = { page: route, server: route.connectToServer() };
    open.add(pair);
    route.onClose(() => open.delete(pair));
  });
  return {
    async drop() {
      down = true;
      for (const pair of [...open]) {
        await pair.page.close();
        await pair.server.close();
      }
      open.clear();
    },
    restore() {
      down = false;
    },
  };
}
