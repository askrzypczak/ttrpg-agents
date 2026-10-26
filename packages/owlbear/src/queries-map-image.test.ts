import { describe, expect, it } from "vitest";
import type { MapPlacement } from "@ttrpg-agents/engine";
import { PROTOCOL_VERSION } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import {
  planMapImage,
  type DrawMapImage,
  type MapImageLayout,
} from "./map-image.js";
import { handleQuery, replyToQuery } from "./queries.js";
import { SceneModel, type SceneItem } from "./scene-model.js";

const MAP_URL = "https://images.owlbear.rodeo/test/trollskull.png";

/** Trollskull Manor on the scene, moved and scaled from where it was registered. */
const mapItem: SceneItem = {
  id: "map-1",
  type: "IMAGE",
  name: "Trollskull Manor",
  visible: true,
  position: { x: 300, y: -150 },
  metadata: {},
  layer: "MAP",
  rotation: 270,
  scale: { x: 1.5, y: 1.5 },
  image: { url: MAP_URL, mime: "image/png", width: 3000, height: 4000 },
  grid: { dpi: 125, offset: { x: 0, y: 0 } },
};

/** The same map at its registered place, unscaled. */
const unscaledItem: SceneItem = {
  ...mapItem,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
};

const SOURCE = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const ENCODED = new Uint8Array([82, 73, 70, 70, 9, 8, 7, 6, 5]);

/** A scene holding `items`, an image fetch that records its urls, and a recording fake drawing. */
function setup(...items: SceneItem[]) {
  const fetched: string[] = [];
  const drawn: Parameters<DrawMapImage>[] = [];
  const { obr, scene } = createFakeObr(new SceneModel(), undefined, {
    fetchImage: (url) => {
      fetched.push(url);
      return SOURCE.slice();
    },
  });
  scene.addItems(items);
  const draw: DrawMapImage = (image, layout) => {
    drawn.push([image, layout]);
    return Promise.resolve((type) =>
      Promise.resolve({ type, bytes: ENCODED.slice() }),
    );
  };
  return { obr, sync: createEncounterSync(obr), draw, fetched, drawn };
}

describe("handleQuery map-image", () => {
  it("a `map-image` query answers the encoding's mime type, its bytes as base64, and the planned layout's width and height", async () => {
    const { obr, sync, draw } = setup(unscaledItem);

    expect(
      await replyToQuery(
        obr,
        sync,
        "q-1",
        { name: "map-image", itemId: "map-1" },
        draw,
      ),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: "query-result",
      id: "q-1",
      payload: {
        name: "map-image",
        result: {
          mimeType: "image/webp",
          data: Buffer.from(ENCODED).toString("base64"),
          width: 1598,
          height: 1222,
        },
      },
    });
  });

  it("the drawing gets the bytes fetched from the item's image url, its mime type, and the layout planned from the item's live placement on the scene grid", async () => {
    const { obr, sync, draw, fetched, drawn } = setup(mapItem);
    const live: MapPlacement = {
      position: { x: 300, y: -150 },
      rotation: 270,
      scale: { x: 1.5, y: 1.5 },
      imageOffset: { x: 0, y: 0 },
      imageWidth: 3000,
      imageHeight: 4000,
      imageDpi: 125,
      sceneDpi: 150,
    };

    const result = await handleQuery(
      obr,
      sync,
      { name: "map-image", itemId: "map-1" },
      draw,
    );

    expect(fetched).toEqual([MAP_URL]);
    const expected: MapImageLayout = planMapImage(live);
    expect(drawn).toEqual([[{ bytes: SOURCE, mime: "image/png" }, expected]]);
    expect(result).toMatchObject({
      name: "map-image",
      result: { width: expected.width, height: expected.height },
    });
  });

  it("a `map-image` query for an id that is not an image on the map layer answers `query-failed` and fetches nothing", async () => {
    const token: SceneItem = {
      ...mapItem,
      id: "token-1",
      layer: "CHARACTER",
    };
    const shape: SceneItem = {
      id: "shape-1",
      type: "SHAPE",
      name: "Box",
      visible: true,
      position: { x: 0, y: 0 },
      metadata: {},
      layer: "MAP",
    };
    const { obr, sync, draw, fetched, drawn } = setup(mapItem, token, shape);

    for (const itemId of ["missing-1", "token-1", "shape-1"]) {
      expect(
        await replyToQuery(
          obr,
          sync,
          `q-${itemId}`,
          { name: "map-image", itemId },
          draw,
        ),
        itemId,
      ).toEqual({
        v: PROTOCOL_VERSION,
        type: "error",
        id: `q-${itemId}`,
        payload: {
          code: "query-failed",
          message: expect.stringContaining(itemId) as unknown,
          fatal: false,
        },
      });
    }
    expect(fetched).toEqual([]);
    expect(drawn).toEqual([]);
  });
});
