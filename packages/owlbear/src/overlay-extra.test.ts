import { describe, expect, it } from "vitest";
import type { MapPlacement, SavedRoom } from "@ttrpg-agents/engine";
import type { MapRooms } from "@ttrpg-agents/protocol";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { createMapOverlay } from "./overlay.js";
import { OVERLAY_METADATA_KEY, planOverlay } from "./overlay-plan.js";
import { SceneModel, type SceneItem } from "./scene-model.js";

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const TROLLSKULL: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  sceneDpi: 150,
};

const mapItem: SceneItem = {
  id: "trollskull",
  type: "IMAGE",
  name: "Trollskull Manor",
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

const token: SceneItem = {
  id: "token",
  type: "IMAGE",
  name: "Shadow 1",
  visible: false,
  position: { x: 450, y: -450 },
  metadata: {},
  layer: "CHARACTER",
};

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

const kitchen: SavedRoom = {
  name: "Kitchen",
  status: "proposed",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
      { x: 0, y: 500 },
    ],
  ],
};

const roomsOf = (...rooms: SavedRoom[]): MapRooms => ({
  itemId: "trollskull",
  rooms,
});

/** Lets fire-and-forget reconciles finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const byId = (a: SceneItem, b: SceneItem) => a.id.localeCompare(b.id);

const overlayItems = (local: SceneModel): SceneItem[] =>
  local
    .getItems((item) => item.metadata[OVERLAY_METADATA_KEY] !== undefined)
    .sort(byId);

const planned = (rooms: SavedRoom[]): SceneItem[] =>
  planOverlay(TROLLSKULL, rooms).sort(byId);

function setup(wrap?: (fake: ObrAdapter) => ObrAdapter) {
  const scene = new SceneModel();
  scene.addItems([mapItem, token]);
  const fake = createFakeObr(scene);
  const errors: unknown[] = [];
  const overlay = createMapOverlay(wrap ? wrap(fake.obr) : fake.obr, {
    onError: (e) => errors.push(e),
  });
  return { overlay, scene, local: fake.local, errors };
}

describe("createMapOverlay, failures and concurrency", () => {
  it("a failed write goes to onError and the next trigger draws the overlay from scratch", async () => {
    let failNextAdd = true;
    const { overlay, scene, local, errors } = setup((fake) => ({
      ...fake,
      addLocalItems: (items) => {
        if (failNextAdd) {
          failNextAdd = false;
          return Promise.reject(new Error("boom"));
        }
        return fake.addLocalItems(items);
      },
    }));

    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(errors).toHaveLength(1);

    scene.updateItems(["token"], { name: "Shadow 2" });
    await settle();

    expect(overlayItems(local)).toEqual(planned([taproom]));
    expect(errors).toHaveLength(1);
  });

  it("rooms that arrive during a draw are drawn after it, with no duplicate items", async () => {
    const { overlay, local, errors } = setup();

    await Promise.all([
      overlay.setRooms(roomsOf(taproom)),
      overlay.setRooms(roomsOf(taproom, kitchen)),
    ]);
    await settle();

    expect(overlayItems(local)).toEqual(planned([taproom, kitchen]));
    expect(errors).toEqual([]);
  });
});
