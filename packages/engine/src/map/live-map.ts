import type { TableMapItem, TablePort, TableSceneMap } from "../table/port.js";
import type { MapRegistration, MapRepository } from "./repository.js";
import type { MapPlacement } from "./types.js";

/** The active map, where its item sits on the scene now, and whether that differs from its registration. */
export interface LiveMap {
  map: MapRegistration;
  placement: MapPlacement;
  moved: boolean;
}

/** The active map or MapSelectionError "No map is in use: use the map first." */
export function requireActiveMap(
  maps: Pick<MapRepository, "getActiveMap">,
): MapRegistration {
  void maps;
  throw new Error("not implemented");
}

/** UnsupportedGridError unless the scene grid is SQUARE (message moved from useMap). */
export function requireSquareGrid(scene: TableSceneMap): void {
  void scene;
  throw new Error("not implemented");
}

/** The item's placement on the scene grid (moved from useMap). */
export function scenePlacement(
  scene: TableSceneMap,
  item: TableMapItem,
): MapPlacement {
  void scene;
  void item;
  throw new Error("not implemented");
}

/** Active map, then the table's live placement of its item; fails when the item is gone or the grid is not square. */
export function liveActiveMap(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap">,
): Promise<LiveMap> {
  void table;
  void maps;
  throw new Error("not implemented");
}
