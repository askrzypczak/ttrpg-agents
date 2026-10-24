import type { Point, Polygon } from "./types.js";

/** A named region of a map, in image px. */
export interface Room {
  name: string;
  polygons: Polygon[];
}

export function roomContains(room: Room, p: Point): boolean {
  void room;
  void p;
  throw new Error("not implemented");
}

export function findRoom(rooms: readonly Room[], name: string): Room {
  void rooms;
  void name;
  throw new Error("not implemented");
}
