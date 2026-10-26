import type { TableMapImage, TablePort } from "../table/port.js";
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
 * The image of the map in use, with the display grid size of its live
 * placement; fails like the other live map reads before the image is asked for.
 */
export function getMapImage(
  table: Pick<TablePort, "sceneMap" | "mapImage">,
  maps: Pick<MapRepository, "getActiveMap">,
): Promise<MapImageResult> {
  void table;
  void maps;
  return Promise.reject(new Error("not implemented"));
}
