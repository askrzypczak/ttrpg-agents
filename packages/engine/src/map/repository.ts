import type { SavedRoom } from "./rooms.js";
import type { MapPlacement } from "./types.js";

/** A map item on the table and how it sits on the scene grid. */
export interface MapRegistration {
  itemId: string;
  name: string;
  placement: MapPlacement;
}

/**
 * Driven port: one encounter's map, and the saved rooms of every map item.
 * A map repository belongs to one encounter; rooms are keyed by map item and
 * shared by every encounter on that item.
 */
export interface MapRepository {
  /**
   * Stores the registration, replacing an earlier registration of the same
   * item, and makes it this repository's encounter's map.
   */
  registerMap(registration: MapRegistration): void;
  /** The encounter's map, or undefined when the encounter has used none. */
  getActiveMap(): MapRegistration | undefined;
  /** The map item's saved rooms, in the order saved; [] when it has none. */
  getRooms(itemId: string): SavedRoom[];
  /** Replaces the map item's rooms with `rooms`, kept in this order, in one transaction. */
  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void;
}
