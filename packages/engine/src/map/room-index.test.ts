import { describe, expect, it } from "vitest";
import {
  InvalidCellRangeError,
  InvalidRoomError,
  MapSelectionError,
  UnknownRoomError,
  UnsupportedGridError,
  cellRangeToPolygon,
  listRooms,
  parseCellRange,
  removeRooms,
  setRooms,
  type MapRegistration,
  type MapRepository,
  type Polygon,
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

/** Image-px polygons of display ranges on Trollskull at 1x. */
const T5_AB11: Polygon = [
  { x: 2500, y: 2375 },
  { x: 2500, y: 3500 },
  { x: 1625, y: 3500 },
  { x: 1625, y: 2375 },
];
const T12_V14: Polygon = [
  { x: 1625, y: 2375 },
  { x: 1625, y: 2750 },
  { x: 1250, y: 2750 },
  { x: 1250, y: 2375 },
];
const A1_C3: Polygon = [
  { x: 3000, y: 0 },
  { x: 3000, y: 375 },
  { x: 2625, y: 375 },
  { x: 2625, y: 0 },
];
const A1: Polygon = [
  { x: 3000, y: 0 },
  { x: 3000, y: 125 },
  { x: 2875, y: 125 },
  { x: 2875, y: 0 },
];

const taproom: SavedRoom = {
  name: "Taproom",
  status: "confirmed",
  polygons: [T5_AB11],
};
const kitchen: SavedRoom = {
  name: "Kitchen",
  status: "confirmed",
  polygons: [A1_C3],
};
const cellar: SavedRoom = {
  name: "Cellar",
  status: "proposed",
  polygons: [A1],
};

function rescaled(item: TableMapItem, factor: number): TableMapItem {
  return { ...item, scale: { x: factor, y: factor } };
}

function scene(maps: TableMapItem[], type = "SQUARE"): TableSceneMap {
  return { grid: { dpi: 150, type }, maps };
}

/** A table that answers `sceneMap` with the given scene and counts the questions. */
function tableWith(
  answer: TableSceneMap,
): Pick<TablePort, "sceneMap"> & { calls: number } {
  const table = {
    calls: 0,
    sceneMap: () => {
      table.calls += 1;
      return Promise.resolve(answer);
    },
  };
  return table;
}

/** An in-memory map repository holding one active map and each item's rooms. */
class MemoryMaps implements MapRepository {
  active: MapRegistration | undefined;
  readonly rooms = new Map<string, SavedRoom[]>();
  writes = 0;

  constructor(active?: MapRegistration, rooms: SavedRoom[] = []) {
    this.active = active;
    if (active) this.rooms.set(active.itemId, structuredClone(rooms));
  }

  registerMap(registration: MapRegistration): void {
    this.active = registration;
  }

  getActiveMap(): MapRegistration | undefined {
    return this.active;
  }

  getRooms(itemId: string): SavedRoom[] {
    return structuredClone(this.rooms.get(itemId) ?? []);
  }

  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void {
    this.writes += 1;
    this.rooms.set(itemId, structuredClone([...rooms]));
  }

  stored(): SavedRoom[] {
    return this.getRooms("map-1");
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

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

describe("setRooms and listRooms", () => {
  it("setRooms stores an L-shaped room from two ranges as two image-px polygons, and listRooms returns both ranges", async () => {
    const maps = new MemoryMaps(registered);
    const table = tableWith(scene([trollskull]));
    await setRooms(table, maps, [
      { name: "Taproom", ranges: ["T5:AB11", "T12:V14"] },
    ]);
    expect(maps.stored()).toEqual([
      { name: "Taproom", status: "confirmed", polygons: [T5_AB11, T12_V14] },
    ]);
    const listed = await listRooms(table, maps);
    expect(listed.map).toEqual(registered);
    expect(listed.rooms).toEqual([
      { name: "Taproom", status: "confirmed", ranges: ["T5:AB11", "T12:V14"] },
    ]);
  });

  it("setRooms replaces a saved room named with different case: one room remains, with the new name casing and ranges", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const result = await setRooms(tableWith(scene([trollskull])), maps, [
      { name: "TAPROOM", ranges: ["A1:C3"] },
    ]);
    expect(maps.stored()).toEqual([
      { name: "TAPROOM", status: "confirmed", polygons: [A1_C3] },
    ]);
    expect(result.rooms).toEqual([
      { name: "TAPROOM", status: "confirmed", ranges: ["A1:C3"] },
    ]);
  });

  it("setRooms keeps the map's other saved rooms when it adds one", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    await setRooms(tableWith(scene([trollskull])), maps, [
      { name: "Kitchen", ranges: ["A1:C3"] },
    ]);
    expect(maps.stored()).toEqual([taproom, kitchen]);
  });

  it("setRooms with a malformed range fails with InvalidCellRangeError and stores none of the rooms in the call", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const error = await rejection(
      setRooms(tableWith(scene([trollskull])), maps, [
        { name: "Kitchen", ranges: ["A1:C3"] },
        { name: "Cellar", ranges: ["5T"] },
      ]),
    );
    expect(error).toBeInstanceOf(InvalidCellRangeError);
    expect(maps.stored()).toEqual([taproom]);
    expect(maps.writes).toBe(0);
  });

  it("setRooms with a range outside the map's display grid (T5:AG11 on the 32 x 24 Trollskull) fails with InvalidCellRangeError naming the grid and stores none of the rooms in the call", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const error = await rejection(
      setRooms(tableWith(scene([trollskull])), maps, [
        { name: "Kitchen", ranges: ["A1:C3"] },
        { name: "Hall", ranges: ["T5:AG11"] },
      ]),
    );
    expect(error).toBeInstanceOf(InvalidCellRangeError);
    expect((error as Error).message).toContain("A1:AF24");
    expect(maps.stored()).toEqual([taproom]);
    expect(maps.writes).toBe(0);
  });
});

describe("removeRooms", () => {
  it("removeRooms removes the named rooms ignoring case and keeps the others", () => {
    const maps = new MemoryMaps(registered, [taproom, kitchen, cellar]);
    const result = removeRooms(maps, ["taproom", "CELLAR"]);
    expect(maps.stored()).toEqual([kitchen]);
    expect(result.map).toEqual(registered);
    expect(result.removed.map((name) => name.toLowerCase())).toEqual([
      "taproom",
      "cellar",
    ]);
  });

  it("removeRooms with an unknown name fails with UnknownRoomError listing the known rooms and removes nothing, not even the known names in the same call", () => {
    const maps = new MemoryMaps(registered, [taproom, kitchen]);
    const error = thrown(() => removeRooms(maps, ["Taproom", "Attic"]));
    expect(error).toBeInstanceOf(UnknownRoomError);
    expect((error as Error).message).toContain("Taproom");
    expect((error as Error).message).toContain("Kitchen");
    expect(maps.stored()).toEqual([taproom, kitchen]);
    expect(maps.writes).toBe(0);
  });
});

describe("room status", () => {
  it("a room set with status proposed lists as proposed", async () => {
    const maps = new MemoryMaps(registered);
    const table = tableWith(scene([trollskull]));
    await setRooms(
      table,
      maps,
      [{ name: "Taproom", ranges: ["T5:AB11"] }],
      "proposed",
    );
    const listed = await listRooms(table, maps);
    expect(listed.rooms).toEqual([
      { name: "Taproom", status: "proposed", ranges: ["T5:AB11"] },
    ]);
  });

  it("a room set without a status lists as confirmed", async () => {
    const maps = new MemoryMaps(registered);
    const table = tableWith(scene([trollskull]));
    await setRooms(table, maps, [{ name: "Taproom", ranges: ["T5:AB11"] }]);
    const listed = await listRooms(table, maps);
    expect(listed.rooms).toEqual([
      { name: "Taproom", status: "confirmed", ranges: ["T5:AB11"] },
    ]);
  });

  it("replacing a proposed room with a confirmed one changes its status", async () => {
    const maps = new MemoryMaps(registered);
    const table = tableWith(scene([trollskull]));
    await setRooms(
      table,
      maps,
      [{ name: "Taproom", ranges: ["T5:AB11"] }],
      "proposed",
    );
    await setRooms(
      table,
      maps,
      [{ name: "Taproom", ranges: ["T5:AB11"] }],
      "confirmed",
    );
    const listed = await listRooms(table, maps);
    expect(listed.rooms).toEqual([
      { name: "Taproom", status: "confirmed", ranges: ["T5:AB11"] },
    ]);
    expect(maps.stored()).toEqual([taproom]);
  });
});

describe("the map in use", () => {
  it("without an active map, setRooms, listRooms and removeRooms each fail with MapSelectionError telling the DM to use the map first, without asking the table", async () => {
    const maps = new MemoryMaps();
    const table = tableWith(scene([trollskull]));
    const errors = [
      await rejection(
        setRooms(table, maps, [{ name: "Taproom", ranges: ["T5:AB11"] }]),
      ),
      await rejection(listRooms(table, maps)),
      thrown(() => removeRooms(maps, ["Taproom"])),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(MapSelectionError);
      expect((error as Error).message).toMatch(/use the map first/i);
    }
    expect(table.calls).toBe(0);
    expect(maps.writes).toBe(0);
  });

  it("setRooms on Trollskull rescaled to 2x since registration stores AM9:BD22 as T5:AB11's 1x image-px polygon and says the map moved", async () => {
    const maps = new MemoryMaps(registered);
    const result = await setRooms(
      tableWith(scene([rescaled(trollskull, 2)])),
      maps,
      [{ name: "Taproom", ranges: ["AM9:BD22"] }],
    );
    const expected = cellRangeToPolygon(
      registered.placement,
      parseCellRange("T5:AB11"),
    );
    expect(maps.stored()).toEqual([
      { name: "Taproom", status: "confirmed", polygons: [expected] },
    ]);
    expect(result.rooms).toEqual([
      { name: "Taproom", status: "confirmed", ranges: ["AM9:BD22"] },
    ]);
    expect(result.moved).toBe(true);
  });

  it("listRooms on Trollskull rescaled to 2x since registration lists a room saved as T5:AB11 at 1x as AM9:BD22 and says the map moved", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const listed = await listRooms(
      tableWith(scene([rescaled(trollskull, 2)])),
      maps,
    );
    expect(listed.rooms).toEqual([
      { name: "Taproom", status: "confirmed", ranges: ["AM9:BD22"] },
    ]);
    expect(listed.moved).toBe(true);
  });

  it("setRooms and listRooms on a map that has not moved say it did not move", async () => {
    const maps = new MemoryMaps(registered);
    const table = tableWith(scene([trollskull]));
    const set = await setRooms(table, maps, [
      { name: "Taproom", ranges: ["T5:AB11"] },
    ]);
    const listed = await listRooms(table, maps);
    expect(set.moved).toBe(false);
    expect(listed.moved).toBe(false);
  });

  it("listRooms lists no range for a region that holds no cell centre under the live transform (A1 saved at 1x, map rescaled to 0.4x)", async () => {
    const maps = new MemoryMaps(registered, [
      { name: "Closet", status: "confirmed", polygons: [A1] },
    ]);
    const listed = await listRooms(
      tableWith(scene([rescaled(trollskull, 0.4)])),
      maps,
    );
    expect(listed.rooms).toEqual([
      { name: "Closet", status: "confirmed", ranges: [] },
    ]);
    expect(listed.moved).toBe(true);
  });

  it("setRooms and listRooms fail with MapSelectionError asking the DM to use the map again when the registered map item is no longer on the scene, and setRooms stores nothing", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const table = tableWith(scene([sewers]));
    const errors = [
      await rejection(
        setRooms(table, maps, [{ name: "Kitchen", ranges: ["A1:C3"] }]),
      ),
      await rejection(listRooms(table, maps)),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(MapSelectionError);
      expect((error as Error).message).toContain("Trollskull Manor");
      expect((error as Error).message).toMatch(/use the map again/i);
    }
    expect(maps.stored()).toEqual([taproom]);
    expect(maps.writes).toBe(0);
  });
});

describe("room input", () => {
  it("setRooms with two rooms whose names match ignoring case fails with InvalidRoomError and stores nothing", async () => {
    const maps = new MemoryMaps(registered, [kitchen]);
    const error = await rejection(
      setRooms(tableWith(scene([trollskull])), maps, [
        { name: "Taproom", ranges: ["T5:AB11"] },
        { name: "taproom", ranges: ["T12:V14"] },
      ]),
    );
    expect(error).toBeInstanceOf(InvalidRoomError);
    expect(maps.stored()).toEqual([kitchen]);
    expect(maps.writes).toBe(0);
  });

  it("setRooms with an empty or whitespace-only name, or a room without ranges, fails with InvalidRoomError and stores nothing", async () => {
    const maps = new MemoryMaps(registered, [kitchen]);
    const table = tableWith(scene([trollskull]));
    const calls = [
      [{ name: "", ranges: ["T5:AB11"] }],
      [{ name: "   ", ranges: ["T5:AB11"] }],
      [
        { name: "Taproom", ranges: ["T5:AB11"] },
        { name: "Hall", ranges: [] },
      ],
    ];
    for (const rooms of calls) {
      const error = await rejection(setRooms(table, maps, rooms));
      expect(error, JSON.stringify(rooms)).toBeInstanceOf(InvalidRoomError);
    }
    expect(maps.stored()).toEqual([kitchen]);
    expect(maps.writes).toBe(0);
  });

  it("setRooms and listRooms fail with UnsupportedGridError when the scene grid is no longer square, and setRooms stores nothing", async () => {
    const maps = new MemoryMaps(registered, [taproom]);
    const table = tableWith(scene([trollskull], "HEX_VERTICAL"));
    const errors = [
      await rejection(
        setRooms(table, maps, [{ name: "Kitchen", ranges: ["A1:C3"] }]),
      ),
      await rejection(listRooms(table, maps)),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(UnsupportedGridError);
      expect((error as Error).message).toContain("HEX_VERTICAL");
    }
    expect(maps.stored()).toEqual([taproom]);
    expect(maps.writes).toBe(0);
  });
});
