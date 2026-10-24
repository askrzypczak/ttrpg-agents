import { UnknownRoomError } from "./errors.js";
import { pointInPolygon } from "./polygon.js";
import type { Point, Polygon } from "./types.js";

/** A named region of a map, in image px. */
export interface Room {
  name: string;
  polygons: Polygon[];
}

/** Whether an image-px point is inside any of the room's polygons. */
export function roomContains(room: Room, p: Point): boolean {
  return room.polygons.some((polygon) => pointInPolygon(p, polygon));
}

/** Finds a room by name, ignoring case. */
export function findRoom(rooms: readonly Room[], name: string): Room {
  const wanted = name.toLowerCase();
  const found = rooms.find((room) => room.name.toLowerCase() === wanted);
  if (found) return found;
  const known =
    rooms.length === 0
      ? "there are no rooms"
      : `known rooms: ${rooms.map((room) => room.name).join(", ")}`;
  throw new UnknownRoomError(`Unknown room "${name}"; ${known}.`);
}
