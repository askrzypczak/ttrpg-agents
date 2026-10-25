import { z } from "zod";
import { UnknownRoomError } from "./errors.js";
import { pointInPolygon } from "./polygon.js";
import type { Point, Polygon } from "./types.js";

/** A named region of a map, in image px. */
export interface Room {
  name: string;
  polygons: Polygon[];
}

export type RoomStatus = "confirmed" | "proposed";

/** A room saved for a map item: its floor area in image px and whether the DM confirmed it. */
export interface SavedRoom extends Room {
  status: RoomStatus;
}

/** Validates a stored room: non-empty name, a status, one or more polygons of three or more finite points. */
export const savedRoomSchema: z.ZodType<SavedRoom> = z.object({
  name: z.string().min(1),
  status: z.enum(["confirmed", "proposed"]),
  polygons: z
    .array(z.array(z.object({ x: z.number(), y: z.number() })).min(3))
    .min(1),
});

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
