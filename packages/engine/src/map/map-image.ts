import type { TableMapImage, TablePort } from "../table/port.js";
import { displayGrid } from "./display-grid.js";
import { liveActiveMap } from "./live-map.js";
import type { MapRegistration, MapRepository } from "./repository.js";

/** The active map's image as the table draws it, with its live display grid size. */
export interface MapImageResult {
  map: MapRegistration;
  cols: number;
  rows: number;
  moved: boolean;
  image: TableMapImage;
}

/**
 * The active map's gridded image from the table, with the display grid size
 * from the engine's live read; fails like `listRooms` before the image is asked for.
 */
export async function getMapImage(
  table: Pick<TablePort, "sceneMap" | "mapImage">,
  maps: Pick<MapRepository, "getActiveMap">,
): Promise<MapImageResult> {
  const live = await liveActiveMap(table, maps);
  const { cols, rows } = displayGrid(live.placement);
  const image = await table.mapImage(live.map.itemId);
  return { map: live.map, cols, rows, moved: live.moved, image };
}
