import { describe, expect, it } from "vitest";
import {
  InvalidCellRangeError,
  InvalidRoomError,
  removeRooms,
  setRooms,
  type MapRegistration,
  type MapRepository,
  type SavedRoom,
  type TableMapItem,
  type TablePort,
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

const square = [
  { x: 0, y: 0 },
  { x: 125, y: 0 },
  { x: 125, y: 125 },
  { x: 0, y: 125 },
];

function room(name: string): SavedRoom {
  return { name, status: "confirmed", polygons: [square] };
}

/** A table showing Trollskull at 1x that counts the questions. */
function countingTable(): Pick<TablePort, "sceneMap"> & { calls: number } {
  const table = {
    calls: 0,
    sceneMap: () => {
      table.calls += 1;
      return Promise.resolve({
        grid: { dpi: 150, type: "SQUARE" },
        maps: [trollskull],
      });
    },
  };
  return table;
}

/** An in-memory map repository with Trollskull active. */
class MemoryMaps implements MapRepository {
  private rooms: SavedRoom[];
  writes = 0;

  constructor(rooms: SavedRoom[] = []) {
    this.rooms = structuredClone(rooms);
  }

  registerMap(): void {}

  getActiveMap(): MapRegistration | undefined {
    return registered;
  }

  getRooms(itemId: string): SavedRoom[] {
    return itemId === registered.itemId ? structuredClone(this.rooms) : [];
  }

  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void {
    expect(itemId).toBe(registered.itemId);
    this.writes += 1;
    this.rooms = structuredClone([...rooms]);
  }

  names(): string[] {
    return this.rooms.map((r) => r.name);
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

describe("setRooms input and order", () => {
  it("setRooms rejects a malformed range, a repeated name or a blank name without asking the table", async () => {
    const maps = new MemoryMaps();
    const table = countingTable();
    const cases: [{ name: string; ranges: string[] }[], unknown][] = [
      [[{ name: "Taproom", ranges: ["5T"] }], InvalidCellRangeError],
      [
        [
          { name: "Taproom", ranges: ["T5:AB11"] },
          { name: "taproom", ranges: ["A1:C3"] },
        ],
        InvalidRoomError,
      ],
      [[{ name: " ", ranges: ["T5:AB11"] }], InvalidRoomError],
    ];
    for (const [rooms, errorClass] of cases) {
      const error = await rejection(setRooms(table, maps, rooms));
      expect(error, JSON.stringify(rooms)).toBeInstanceOf(errorClass);
      expect(table.calls).toBe(0);
      expect(maps.names()).toEqual([]);
      expect(maps.writes).toBe(0);
    }
  });

  it("setRooms replacing a room keeps its place among the saved rooms", async () => {
    const maps = new MemoryMaps([
      room("Taproom"),
      room("Kitchen"),
      room("Cellar"),
    ]);
    await setRooms(countingTable(), maps, [
      { name: "KITCHEN", ranges: ["D1:D2"] },
    ]);
    expect(maps.names()).toEqual(["Taproom", "KITCHEN", "Cellar"]);
  });
});

describe("removeRooms names", () => {
  it("removeRooms given the same room twice removes it and reports it once", () => {
    const maps = new MemoryMaps([room("Attic"), room("Cellar")]);
    const result = removeRooms(maps, ["Attic", "attic"]);
    expect(result.removed).toEqual(["Attic"]);
    expect(maps.names()).toEqual(["Cellar"]);
  });
});
