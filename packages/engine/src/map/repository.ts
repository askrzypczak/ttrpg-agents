import type { SavedRoom } from "./rooms.js";
import type { MapPlacement } from "./types.js";

/** A map item on the table and how it sits on the scene grid. */
export interface MapRegistration {
  itemId: string;
  name: string;
  placement: MapPlacement;
}

/** Driven port: the registered maps and the active one. */
export interface MapRepository {
  /**
   * Stores the registration and makes it the active map, replacing an
   * earlier registration of the same item.
   */
  registerMap(registration: MapRegistration): void;
  /** The active map's registration, or undefined when no map has been used. */
  getActiveMap(): MapRegistration | undefined;
  /** The map item's saved rooms, in the order saved; [] when it has none. */
  getRooms(itemId: string): SavedRoom[];
  /** Replaces the map item's rooms with `rooms`, kept in this order, in one transaction. */
  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void;
}
