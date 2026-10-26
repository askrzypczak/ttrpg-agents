import { describe, expect, it } from "vitest";
import {
  MapSelectionError,
  getMapImage,
  type MapRegistration,
  type MapRepository,
  type TableMapImage,
  type TableMapItem,
  type TablePort,
  type TableSceneMap,
} from "../index.js";

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270 (32 x 24 cells). */
const trollskull: TableMapItem = {
  id: "map-1",
  name: "Trollskull Manor",
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  imageOffset: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
};

const sewers: TableMapItem = { ...trollskull, id: "map-2", name: "Sewers" };

/** Trollskull as registered, at scale 1x. */
const registered: MapRegistration = {
  itemId: "map-1",
  name: "Trollskull Manor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 270,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 3000,
    imageHeight: 4000,
    imageDpi: 125,
    sceneDpi: 150,
  },
};

const image: TableMapImage = {
  mimeType: "image/webp",
  data: "UklGRg==",
  width: 1600,
  height: 1200,
};

function scene(maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

/** A table that answers the scene and the image, and records what it was asked. */
function tableWith(answer: TableSceneMap): Pick<
  TablePort,
  "sceneMap" | "mapImage"
> & {
  sceneCalls: number;
  imageCalls: string[];
} {
  const table = {
    sceneCalls: 0,
    imageCalls: [] as string[],
    sceneMap: () => {
      table.sceneCalls += 1;
      return Promise.resolve(answer);
    },
    mapImage: (itemId: string) => {
      table.imageCalls.push(itemId);
      return Promise.resolve(image);
    },
  };
  return table;
}

function mapsWith(
  active: MapRegistration | undefined,
): Pick<MapRepository, "getActiveMap"> {
  return { getActiveMap: () => active };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("getMapImage", () => {
  it("getMapImage returns the table's image of the active map's item with the display grid size of its live placement", async () => {
    const table = tableWith(scene([sewers, trollskull]));
    const result = await getMapImage(table, mapsWith(registered));
    expect(result).toEqual({
      map: registered,
      cols: 32,
      rows: 24,
      moved: false,
      image,
    });
    expect(table.imageCalls).toEqual(["map-1"]);
  });

  it("getMapImage says the map moved when its live placement differs from its registration", async () => {
    const table = tableWith(scene([{ ...trollskull, scale: { x: 2, y: 2 } }]));
    const result = await getMapImage(table, mapsWith(registered));
    expect(result.moved).toBe(true);
    expect(result.cols).toBe(64);
    expect(result.rows).toBe(48);
    expect(result.image).toEqual(image);
  });

  it("getMapImage with no map in use fails with MapSelectionError without asking the table", async () => {
    const table = tableWith(scene([trollskull]));
    const error = await rejection(getMapImage(table, mapsWith(undefined)));
    expect(error).toBeInstanceOf(MapSelectionError);
    expect(table.sceneCalls).toBe(0);
    expect(table.imageCalls).toEqual([]);
  });

  it("getMapImage does not ask for the image when the map's item is no longer on the scene", async () => {
    const table = tableWith(scene([sewers]));
    const error = await rejection(getMapImage(table, mapsWith(registered)));
    expect(error).toBeInstanceOf(MapSelectionError);
    expect(table.imageCalls).toEqual([]);
  });
});
