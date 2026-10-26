import { describe, expect, it } from "vitest";
import type { MapPlacement, SavedRoom } from "@ttrpg-agents/engine";
import type { MapRooms } from "@ttrpg-agents/protocol";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { createMapOverlay } from "./overlay.js";
import { OVERLAY_METADATA_KEY, planOverlay } from "./overlay-plan.js";
import { SceneModel, type SceneGrid, type SceneItem } from "./scene-model.js";

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
  metadata: { "com.example/other": { keep: true } },
  layer: "CHARACTER",
};

/** A local item another extension (or the GM) made. */
const foreignLocal: SceneItem = {
  id: "ruler",
  type: "LINE",
  name: "Ruler",
  visible: true,
  position: { x: 10, y: 20 },
  metadata: { "com.example/ruler": { length: 3 } },
  layer: "DRAWING",
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
const noMap: MapRooms = { itemId: null, rooms: [] };

/** Lets fire-and-forget reconciles (item changes, ready flips) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const byId = (a: SceneItem, b: SceneItem) => a.id.localeCompare(b.id);

/** The overlay items among the local items, sorted by id. */
const overlayItems = (local: SceneModel): SceneItem[] =>
  local
    .getItems((item) => item.metadata[OVERLAY_METADATA_KEY] !== undefined)
    .sort(byId);

/** The overlay planned for this placement and rooms, sorted by id. */
const planned = (placement: MapPlacement, rooms: SavedRoom[]): SceneItem[] =>
  planOverlay(placement, rooms).sort(byId);

/** An overlay over the fake with the map item and a token on the scene; records its errors. */
function setup(
  options: {
    scene?: SceneModel;
    grid?: SceneGrid;
    local?: SceneModel;
    obr?: (fake: ObrAdapter) => ObrAdapter;
  } = {},
) {
  const scene = options.scene ?? new SceneModel();
  scene.addItems([mapItem, token]);
  const fake = createFakeObr(scene, undefined, {
    grid: options.grid,
    local: options.local,
  });
  const errors: unknown[] = [];
  const obr = options.obr ? options.obr(fake.obr) : fake.obr;
  const overlay = createMapOverlay(obr, { onError: (e) => errors.push(e) });
  return { overlay, scene, local: fake.local, errors };
}

describe("createMapOverlay", () => {
  it("the overlay is drawn as local items when the rooms arrive and the map item is on the scene", async () => {
    const { overlay, local, errors } = setup();

    await overlay.setRooms(roomsOf(taproom));
    await settle();

    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));
    expect(errors).toEqual([]);
  });

  it("the overlay is redrawn when the map item is moved", async () => {
    const { overlay, scene, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();

    scene.updateItems(["trollskull"], { position: { x: 300, y: 150 } });
    await settle();

    expect(overlayItems(local)).toEqual(
      planned({ ...TROLLSKULL, position: { x: 300, y: 150 } }, [taproom]),
    );
    expect(errors).toEqual([]);
  });

  it("the overlay is redrawn when the rooms change", async () => {
    const { overlay, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();

    await overlay.setRooms(roomsOf(taproom, kitchen));
    await settle();

    expect(overlayItems(local)).toEqual(
      planned(TROLLSKULL, [taproom, kitchen]),
    );
    expect(errors).toEqual([]);
  });

  it("toggling the overlay off removes all of it, and toggling it on draws it again", async () => {
    const { overlay, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(overlayItems(local)).not.toEqual([]);

    await overlay.setEnabled(false);
    await settle();
    expect(overlayItems(local)).toEqual([]);

    await overlay.setEnabled(true);
    await settle();
    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));
    expect(errors).toEqual([]);
  });

  it("deleting the map item removes the whole overlay", async () => {
    const { overlay, scene, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(overlayItems(local)).not.toEqual([]);

    scene.deleteItems(["trollskull"]);
    await settle();

    expect(overlayItems(local)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("no map in use removes the whole overlay", async () => {
    const { overlay, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(overlayItems(local)).not.toEqual([]);

    await overlay.setRooms(noMap);
    await settle();

    expect(overlayItems(local)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("local items without the overlay metadata key are never removed or changed", async () => {
    const local = new SceneModel();
    local.addItems([foreignLocal]);
    const { overlay, scene } = setup({ local });
    const foreignOnly = () =>
      local.getItems(
        (item) => item.metadata[OVERLAY_METADATA_KEY] === undefined,
      );

    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(overlayItems(local)).not.toEqual([]);
    expect(foreignOnly()).toEqual([foreignLocal]);

    scene.updateItems(["trollskull"], { position: { x: 300, y: 150 } });
    await settle();
    await overlay.setRooms(roomsOf(taproom, kitchen));
    await settle();
    await overlay.setEnabled(false);
    await settle();
    expect(overlayItems(local)).toEqual([]);
    expect(foreignOnly()).toEqual([foreignLocal]);

    await overlay.setEnabled(true);
    await settle();
    scene.deleteItems(["trollskull"]);
    await settle();
    expect(foreignOnly()).toEqual([foreignLocal]);
  });

  it("no scene item and no scene metadata is written", async () => {
    const writes: string[] = [];
    const { overlay, scene, local } = setup({
      obr: (fake) => ({
        ...fake,
        addItems: (i) => (writes.push("addItems"), fake.addItems(i)),
        updateItems: (ids, p) => (
          writes.push("updateItems"),
          fake.updateItems(ids, p)
        ),
        setItemMetadata: (u) => (
          writes.push("setItemMetadata"),
          fake.setItemMetadata(u)
        ),
        deleteItems: (i) => (writes.push("deleteItems"), fake.deleteItems(i)),
        setSceneMetadata: (u) => (
          writes.push("setSceneMetadata"),
          fake.setSceneMetadata(u)
        ),
      }),
    });

    await overlay.setRooms(roomsOf(taproom));
    await settle();
    scene.updateItems(["trollskull"], { position: { x: 300, y: 150 } });
    await settle();
    await overlay.setEnabled(false);
    await settle();
    await overlay.setEnabled(true);
    await settle();
    expect(overlayItems(local)).not.toEqual([]);

    expect(writes).toEqual([]);
    expect(scene.getItems().sort(byId)).toEqual(
      [{ ...mapItem, position: { x: 300, y: 150 } }, token].sort(byId),
    );
    expect(scene.getMetadata()).toEqual({});
  });

  it("overlay items left by an earlier load are removed before the first draw", async () => {
    const local = new SceneModel();
    const [firstPlanned] = planned(TROLLSKULL, [taproom]);
    local.addItems([
      foreignLocal,
      {
        ...firstPlanned!,
        text: firstPlanned!.text && { ...firstPlanned!.text, plainText: "ZZ" },
        position: { x: -999, y: -999 },
      },
      {
        id: "stale-overlay-outline",
        type: "CURVE",
        name: "Old room",
        visible: true,
        position: { x: 0, y: 0 },
        metadata: { [OVERLAY_METADATA_KEY]: { part: "room-outline" } },
        layer: "DRAWING",
      },
    ]);
    const { overlay, errors } = setup({ local });

    await overlay.setRooms(roomsOf(taproom));
    await settle();

    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));
    expect(
      local.getItems(
        (item) => item.metadata[OVERLAY_METADATA_KEY] === undefined,
      ),
    ).toEqual([foreignLocal]);
    expect(errors).toEqual([]);
  });

  it("nothing is drawn until the scene is ready, then the overlay is drawn", async () => {
    const { overlay, scene, local, errors } = setup({
      scene: new SceneModel("gm", false),
    });

    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(local.getItems()).toEqual([]);

    scene.setReady(true);
    await settle();

    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));
    expect(errors).toEqual([]);
  });

  it("a change to another scene item does not redraw the overlay", async () => {
    const { overlay, scene, local, errors } = setup();
    await overlay.setRooms(roomsOf(taproom));
    await settle();
    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));

    let localChanges = 0;
    local.onChange(() => localChanges++);
    scene.updateItems(["token"], { position: { x: 900, y: -900 } });
    await settle();
    scene.updateItems(["token"], { name: "Shadow 2" });
    await settle();

    expect(localChanges).toBe(0);
    expect(overlayItems(local)).toEqual(planned(TROLLSKULL, [taproom]));
    expect(errors).toEqual([]);
  });

  it("a grid that is not square gets no overlay", async () => {
    const { overlay, local, errors } = setup({
      grid: { dpi: 150, type: "HEX_VERTICAL" },
    });

    await overlay.setRooms(roomsOf(taproom));
    await settle();

    expect(overlayItems(local)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
