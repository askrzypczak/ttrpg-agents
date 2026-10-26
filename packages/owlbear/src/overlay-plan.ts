import type { MapPlacement, SavedRoom } from "@ttrpg-agents/engine";
import type { SceneGrid, SceneItem } from "./scene-model.js";

/** Item metadata key marking an overlay item; its value is `{ part }`. */
export const OVERLAY_METADATA_KEY = "com.ttrpg-agents/overlay";

/** What an overlay item draws. */
export type OverlayPart =
  | "column-label"
  | "column-tick"
  | "row-label"
  | "row-tick"
  | "room-outline"
  | "room-name";

/**
 * The placement of a map image on the scene grid, or undefined unless the
 * item is an IMAGE on the MAP layer with image and grid specs.
 */
export function mapPlacementOf(
  item: SceneItem,
  grid: SceneGrid,
): MapPlacement | undefined {
  void item;
  void grid;
  throw new Error("not implemented");
}

/**
 * The overlay's items in scene coordinates: the display grid's column and
 * row labels and ticks, and each room's outlines and name.
 */
export function planOverlay(
  placement: MapPlacement,
  rooms: readonly SavedRoom[],
): SceneItem[] {
  void placement;
  void rooms;
  throw new Error("not implemented");
}
