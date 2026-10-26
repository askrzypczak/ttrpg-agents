import type { SceneItem } from "../src/scene-model.js";
import { test, expect, openHarness } from "./fixtures.js";

/** Served cross-origin, as the Owlbear CDN serves map images. */
const MAP_URL = "https://images.owlbear.rodeo/e2e/trollskull.png";

/** The bytes served for the map image: a 1x1 PNG. */
const MAP_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Trollskull Manor on the scene: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const mapItem: SceneItem = {
  id: "e2e-trollskull",
  type: "IMAGE",
  name: "Trollskull Manor",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
  layer: "MAP",
  rotation: 270,
  scale: { x: 1, y: 1 },
  image: { url: MAP_URL, mime: "image/png", width: 3000, height: 4000 },
  grid: { dpi: 125, offset: { x: 0, y: 0 } },
};

test.describe("map image query -> bridge -> extension", () => {
  test("POST `map-image` for the map on the scene returns a WEBP of the planned size, drawn by the real extension from an image served cross-origin with CORS", async ({
    page,
    bridge,
  }) => {
    await page.route(MAP_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: MAP_PNG,
      }),
    );

    const post = async (query: unknown) => {
      const res = await fetch(`${bridge.origin}/agent/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(query),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep the raw text so a failure shows what came back
      }
      return { status: res.status, body, length: text.length };
    };

    await openHarness(page, { role: "gm" });
    await page.evaluate(
      (item) => window.__host!.scene.addItems([item]),
      mapItem,
    );
    // The extension answers queries once it is connected to the bridge.
    await expect
      .poll(async () => (await post({ name: "scene-status" })).status)
      .toBe(200);

    const started = Date.now();
    const res = await post({ name: "map-image", itemId: mapItem.id });
    const elapsedMs = Date.now() - started;

    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    const body = res.body as {
      ok: boolean;
      result: {
        name: string;
        result: {
          mimeType: string;
          data: string;
          width: number;
          height: number;
        };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.name).toBe("map-image");
    const { mimeType, data, width, height } = body.result.result;
    expect({ mimeType, width, height }).toEqual({
      mimeType: "image/webp",
      width: 1598,
      height: 1222,
    });
    const bytes = Buffer.from(data, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const size = await page.evaluate(async (b64) => {
      const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([decoded], { type: "image/webp" }),
      );
      return { width: bitmap.width, height: bitmap.height };
    }, data);
    expect(size).toEqual({ width: 1598, height: 1222 });

    test
      .info()
      .annotations.push(
        { type: "map-image elapsed ms", description: String(elapsedMs) },
        { type: "map-image data length", description: String(data.length) },
        { type: "map-image reply length", description: String(res.length) },
      );
  });
});
