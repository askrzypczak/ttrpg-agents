import { describe, expect, it } from "vitest";
import {
  UnknownRoomError,
  findRoom,
  roomContains,
  type Polygon,
  type Room,
} from "../index.js";

function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const TAPROOM: Room = {
  name: "Taproom",
  polygons: [rect(0, 0, 10, 10), rect(100, 100, 110, 110)],
};
const CELLAR: Room = { name: "Cellar", polygons: [rect(200, 0, 300, 50)] };

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("roomContains", () => {
  it("contains a point inside any one of the room's polygons", () => {
    expect(roomContains(TAPROOM, { x: 5, y: 5 })).toBe(true);
    expect(roomContains(TAPROOM, { x: 105, y: 105 })).toBe(true);
  });

  it("excludes a point inside none of them", () => {
    expect(roomContains(TAPROOM, { x: 50, y: 50 })).toBe(false);
    expect(roomContains(TAPROOM, { x: -1, y: 5 })).toBe(false);
    expect(roomContains(TAPROOM, { x: 250, y: 25 })).toBe(false);
  });
});

describe("findRoom", () => {
  it("finds a room by name ignoring case", () => {
    const rooms = [CELLAR, TAPROOM];
    expect(findRoom(rooms, "Taproom")).toBe(TAPROOM);
    expect(findRoom(rooms, "taproom")).toBe(TAPROOM);
    expect(findRoom(rooms, "TAPROOM")).toBe(TAPROOM);
    expect(findRoom(rooms, "cellar")).toBe(CELLAR);
  });

  it("lists the known rooms in the error for an unknown name", () => {
    const error = thrownBy(() => findRoom([CELLAR, TAPROOM], "Attic"));
    expect(error).toBeInstanceOf(UnknownRoomError);
    expect((error as UnknownRoomError).code).toBe("unknown_room");
    expect((error as UnknownRoomError).message).toContain("Cellar");
    expect((error as UnknownRoomError).message).toContain("Taproom");
  });

  it("says there are no rooms when the list is empty", () => {
    const error = thrownBy(() => findRoom([], "Attic"));
    expect(error).toBeInstanceOf(UnknownRoomError);
    expect((error as UnknownRoomError).message).toMatch(/no rooms|none/i);
  });
});
