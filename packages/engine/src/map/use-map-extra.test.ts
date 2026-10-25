import { describe, expect, it } from "vitest";
import {
  MapSelectionError,
  UnsupportedGridError,
  useMap,
  type MapRegistration,
  type MapRepository,
  type SavedRoom,
  type TableMapItem,
  type TablePort,
  type TableSceneMap,
} from "../index.js";

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

function scene(maps: TableMapItem[], type = "SQUARE"): TableSceneMap {
  return { grid: { dpi: 150, type }, maps };
}

function tableWith(answer: TableSceneMap): Pick<TablePort, "sceneMap"> {
  return { sceneMap: () => Promise.resolve(answer) };
}

class RecordingMaps implements MapRepository {
  readonly registered: MapRegistration[] = [];

  registerMap(registration: MapRegistration): void {
    this.registered.push(registration);
  }

  getActiveMap(): MapRegistration | undefined {
    return this.registered.at(-1);
  }

  getRooms(): SavedRoom[] {
    return [];
  }

  replaceRooms(): void {
    throw new Error("useMap does not store rooms");
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("useMap guards", () => {
  it("useMap with a map smaller than one cell fails and stores nothing", async () => {
    const maps = new RecordingMaps();
    const tiny: TableMapItem = { ...trollskull, imageDpi: 10000 };
    const error = await rejection(useMap(tableWith(scene([tiny])), maps));
    expect(error).toBeInstanceOf(MapSelectionError);
    expect(maps.registered).toEqual([]);
  });

  it("useMap on a non-square grid with several maps and no name fails with UnsupportedGridError", async () => {
    const maps = new RecordingMaps();
    const error = await rejection(
      useMap(tableWith(scene([trollskull, sewers], "HEX_VERTICAL")), maps),
    );
    expect(error).toBeInstanceOf(UnsupportedGridError);
    expect(maps.registered).toEqual([]);
  });
});
