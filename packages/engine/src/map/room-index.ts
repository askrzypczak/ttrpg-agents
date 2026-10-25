import type { TablePort } from "../table/port.js";
import type { MapRegistration, MapRepository } from "./repository.js";
import type { RoomStatus } from "./rooms.js";

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

/**
 * Saves rooms on the map in use from display-cell ranges read under the map's
 * live transform; a room named like a saved one (ignoring case) replaces it.
 * Every check runs before anything is stored.
 */
export function setRooms(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap" | "getRooms" | "replaceRooms">,
  rooms: readonly RoomInput[],
  status?: RoomStatus,
): Promise<SetRoomsResult> {
  void table;
  void maps;
  void rooms;
  void status;
  throw new Error("not implemented");
}

/** The saved rooms of the map in use, with their ranges under its live transform. */
export function listRooms(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap" | "getRooms">,
): Promise<ListRoomsResult> {
  void table;
  void maps;
  throw new Error("not implemented");
}

/** Removes saved rooms by name, ignoring case; every name must match before any is removed. */
export function removeRooms(
  maps: Pick<MapRepository, "getActiveMap" | "getRooms" | "replaceRooms">,
  names: readonly string[],
): RemoveRoomsResult {
  void maps;
  void names;
  throw new Error("not implemented");
}
