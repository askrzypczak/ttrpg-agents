import { describe, expect, it } from "vitest";
import {
  MapSelectionError,
  TableUnavailableError,
  UnsupportedGridError,
  useMap,
  type MapRegistration,
  type MapRepository,
  type SavedRoom,
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

function scene(maps: TableMapItem[], type = "SQUARE"): TableSceneMap {
  return { grid: { dpi: 150, type }, maps };
}

/** A table that answers `sceneMap` with the given scene. */
function tableWith(answer: TableSceneMap): Pick<TablePort, "sceneMap"> {
  return { sceneMap: () => Promise.resolve(answer) };
}

/** An in-memory map repository that records every registration. */
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

describe("useMap", () => {
  it("useMap picks the only map when no name is given and makes it the active map", async () => {
    const maps = new RecordingMaps();
    await useMap(tableWith(scene([trollskull])), maps);
    expect(maps.registered).toHaveLength(1);
    expect(maps.registered[0]?.itemId).toBe("map-1");
    expect(maps.getActiveMap()?.itemId).toBe("map-1");
  });

  it("useMap stores the map's transform and the scene dpi as its placement and returns its display grid size, 32 x 24 for Trollskull", async () => {
    const maps = new RecordingMaps();
    const result = await useMap(tableWith(scene([trollskull])), maps);
    const expected: MapRegistration = {
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
    expect(maps.registered).toEqual([expected]);
    expect(result).toEqual({ map: expected, cols: 32, rows: 24 });
  });

  it("useMap with several maps and no name fails, lists their names and stores nothing", async () => {
    const maps = new RecordingMaps();
    const error = await rejection(
      useMap(tableWith(scene([trollskull, sewers])), maps),
    );
    expect(error).toBeInstanceOf(MapSelectionError);
    expect((error as Error).message).toContain("Trollskull Manor");
    expect((error as Error).message).toContain("Sewers");
    expect(maps.registered).toEqual([]);
  });

  it("useMap picks a map by name ignoring case", async () => {
    const maps = new RecordingMaps();
    const result = await useMap(
      tableWith(scene([trollskull, sewers])),
      maps,
      "sewers",
    );
    expect(result.map.itemId).toBe("map-2");
    expect(result.map.name).toBe("Sewers");
    expect(maps.registered.map((r) => r.itemId)).toEqual(["map-2"]);
  });

  it("useMap with a name that matches no map fails, lists the maps' names and stores nothing", async () => {
    const maps = new RecordingMaps();
    const error = await rejection(
      useMap(tableWith(scene([trollskull, sewers])), maps, "Yawning Portal"),
    );
    expect(error).toBeInstanceOf(MapSelectionError);
    expect((error as Error).message).toContain("Trollskull Manor");
    expect((error as Error).message).toContain("Sewers");
    expect(maps.registered).toEqual([]);
  });

  it("useMap with a name two maps share fails, lists the maps' names and stores nothing", async () => {
    const maps = new RecordingMaps();
    const twin: TableMapItem = { ...trollskull, id: "map-3" };
    const error = await rejection(
      useMap(tableWith(scene([trollskull, twin])), maps, "trollskull manor"),
    );
    expect(error).toBeInstanceOf(MapSelectionError);
    expect((error as Error).message).toContain("Trollskull Manor");
    expect(maps.registered).toEqual([]);
  });

  it("useMap with no map on the scene fails and stores nothing", async () => {
    const maps = new RecordingMaps();
    const error = await rejection(useMap(tableWith(scene([])), maps));
    expect(error).toBeInstanceOf(MapSelectionError);
    expect(maps.registered).toEqual([]);
  });

  it("useMap on a non-square grid fails naming the grid type and stores nothing", async () => {
    const maps = new RecordingMaps();
    const error = await rejection(
      useMap(tableWith(scene([trollskull], "HEX_VERTICAL")), maps),
    );
    expect(error).toBeInstanceOf(UnsupportedGridError);
    expect((error as Error).message).toContain("HEX_VERTICAL");
    expect(maps.registered).toEqual([]);
  });

  it("a table error from useMap propagates as `TableUnavailableError` and stores nothing", async () => {
    const maps = new RecordingMaps();
    const table: Pick<TablePort, "sceneMap"> = {
      sceneMap: () =>
        Promise.reject(
          new TableUnavailableError(
            "no Owlbear GM tab is connected to the bridge",
          ),
        ),
    };
    const error = await rejection(useMap(table, maps));
    expect(error).toBeInstanceOf(TableUnavailableError);
    expect(maps.registered).toEqual([]);
  });
});
