import type { TablePort } from "../table/port.js";
import type { MapRegistration, MapRepository } from "./repository.js";

/** The map just made active and its display grid size. */
export interface UsedMap {
  map: MapRegistration;
  cols: number;
  rows: number;
}

/**
 * Reads the scene's maps, picks one (the only one, or by name ignoring case),
 * registers its placement and makes it the active map.
 */
export async function useMap(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "registerMap">,
  name?: string,
): Promise<UsedMap> {
  void table;
  void maps;
  void name;
  await Promise.resolve();
  throw new Error("not implemented");
}
