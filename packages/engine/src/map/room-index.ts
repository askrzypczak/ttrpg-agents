import type { TablePort } from "../table/port.js";
import {
  cellRangeToPolygon,
  displayGrid,
  formatCellRange,
  parseCellRange,
  polygonToCellRange,
  type CellRange,
} from "./display-grid.js";
import { InvalidCellRangeError, InvalidRoomError } from "./errors.js";
import { liveActiveMap, requireActiveMap } from "./live-map.js";
import type { MapRegistration, MapRepository } from "./repository.js";
import { findRoom, type RoomStatus, type SavedRoom } from "./rooms.js";

/** A room as the DM names it: a name and one or more display-cell ranges such as "T5:AB11". */
export interface RoomInput {
  name: string;
  ranges: readonly string[];
}

/** A room with its ranges in display cells ("T5:AB11"). */
export interface RoomView {
  name: string;
  status: RoomStatus;
  ranges: string[];
}

export interface SetRoomsResult {
  map: MapRegistration;
  rooms: RoomView[];
  moved: boolean;
}

export interface ListRoomsResult {
  map: MapRegistration;
  rooms: RoomView[];
  moved: boolean;
}

export interface RemoveRoomsResult {
  map: MapRegistration;
  removed: string[];
}

/** A room input with its ranges parsed. */
interface ParsedRoom {
  name: string;
  ranges: CellRange[];
}

/**
 * Saves rooms on the map in use from display-cell ranges read under the map's
 * live transform; a room named like a saved one (ignoring case) replaces it.
 * Every check runs before anything is stored.
 */
export async function setRooms(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap" | "getRooms" | "replaceRooms">,
  rooms: readonly RoomInput[],
  status: RoomStatus = "confirmed",
): Promise<SetRoomsResult> {
  requireActiveMap(maps);
  const parsed = parseRooms(rooms);
  const live = await liveActiveMap(table, maps);
  const { cols, rows } = displayGrid(live.placement);
  const gridLabel = formatCellRange({
    from: { col: 0, row: 0 },
    to: { col: cols - 1, row: rows - 1 },
  });
  for (const room of parsed) {
    for (const range of room.ranges) {
      if (range.to.col >= cols || range.to.row >= rows) {
        throw new InvalidCellRangeError(
          `Cell range "${formatCellRange(range)}" is outside the map's grid ${gridLabel}.`,
        );
      }
    }
  }
  const saved: SavedRoom[] = parsed.map((room) => ({
    name: room.name,
    status,
    polygons: room.ranges.map((range) =>
      cellRangeToPolygon(live.placement, range),
    ),
  }));
  const merged = maps.getRooms(live.map.itemId);
  for (const room of saved) {
    const wanted = room.name.toLowerCase();
    const index = merged.findIndex((r) => r.name.toLowerCase() === wanted);
    if (index === -1) merged.push(room);
    else merged[index] = room;
  }
  maps.replaceRooms(live.map.itemId, merged);
  return {
    map: live.map,
    rooms: parsed.map((room) => ({
      name: room.name,
      status,
      ranges: room.ranges.map(formatCellRange),
    })),
    moved: live.moved,
  };
}

/** A proposed room with its ranges shrunk, in display cells ("U6:AA10"). */
export interface RoomProposal {
  name: string;
  ranges: string[];
}

/**
 * Checks rooms like setRooms and shrinks each range by one cell at both ends
 * of every axis it spans three or more cells on; reads and stores nothing.
 */
export function proposeRooms(rooms: readonly RoomInput[]): RoomProposal[] {
  void rooms;
  throw new Error("not implemented");
}

/** The saved rooms of the map in use, with their ranges under its live transform. */
export async function listRooms(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap" | "getRooms">,
): Promise<ListRoomsResult> {
  const live = await liveActiveMap(table, maps);
  const rooms = maps.getRooms(live.map.itemId).map((room) => ({
    name: room.name,
    status: room.status,
    ranges: room.polygons.flatMap((polygon) => {
      const range = polygonToCellRange(live.placement, polygon);
      return range ? [formatCellRange(range)] : [];
    }),
  }));
  return { map: live.map, rooms, moved: live.moved };
}

/** Removes saved rooms by name, ignoring case; every name must match before any is removed. */
export function removeRooms(
  maps: Pick<MapRepository, "getActiveMap" | "getRooms" | "replaceRooms">,
  names: readonly string[],
): RemoveRoomsResult {
  const map = requireActiveMap(maps);
  const rooms = maps.getRooms(map.itemId);
  const found = new Set(names.map((name) => findRoom(rooms, name)));
  maps.replaceRooms(
    map.itemId,
    rooms.filter((room) => !found.has(room)),
  );
  return { map, removed: [...found].map((room) => room.name) };
}

/** Checks the rooms' names and parses their ranges; throws before anything is read or stored. */
function parseRooms(rooms: readonly RoomInput[]): ParsedRoom[] {
  const seen = new Set<string>();
  return rooms.map((room) => {
    if (room.name.trim() === "") {
      throw new InvalidRoomError("A room needs a name.");
    }
    const key = room.name.toLowerCase();
    if (seen.has(key)) {
      throw new InvalidRoomError(
        `The room "${room.name}" is named more than once; name each room once.`,
      );
    }
    seen.add(key);
    if (room.ranges.length === 0) {
      throw new InvalidRoomError(
        `The room "${room.name}" needs one or more cell ranges such as "T5:AB11".`,
      );
    }
    return { name: room.name, ranges: room.ranges.map(parseCellRange) };
  });
}
