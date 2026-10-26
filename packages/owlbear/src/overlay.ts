import type { MapRooms } from "@ttrpg-agents/protocol";
import type { ObrAdapter } from "./obr-adapter.js";

/** The map overlay of this tab: grid labels and room outlines as local items. */
export interface MapOverlay {
  /** The active map's rooms, from the bridge's `map-rooms`. */
  setRooms(rooms: MapRooms): Promise<void>;
  /** Shows (true) or removes (false) the overlay. */
  setEnabled(enabled: boolean): Promise<void>;
}

/** Creates the overlay, on; it draws once the first rooms arrive and the scene is ready. */
export function createMapOverlay(
  obr: ObrAdapter,
  options?: { onError?: (error: unknown) => void },
): MapOverlay {
  void obr;
  void options;
  throw new Error("not implemented");
}
