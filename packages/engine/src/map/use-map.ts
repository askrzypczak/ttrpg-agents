import type { TableMapItem, TablePort, TableSceneMap } from "../table/port.js";
import { displayGrid } from "./display-grid.js";
import { MapSelectionError, UnsupportedGridError } from "./errors.js";
import type { MapRegistration, MapRepository } from "./repository.js";
import type { MapPlacement } from "./types.js";

/** The map just made active and its display grid size. */
export interface UsedMap {
  map: MapRegistration;
  cols: number;
  rows: number;
}

/**
 * Reads the scene's maps, picks one (the only one, or by name ignoring case),
 * registers its placement and makes it the active map. Every check runs
 * before anything is stored.
 */
export async function useMap(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "registerMap">,
  name?: string,
): Promise<UsedMap> {
  const scene = await table.sceneMap();
  if (scene.grid.type !== "SQUARE") {
    throw new UnsupportedGridError(
      `Only square grids are supported; this scene's grid is ${scene.grid.type}.`,
    );
  }
  const item = chooseMap(scene, name);
  const placement: MapPlacement = {
    position: { x: item.position.x, y: item.position.y },
    rotation: item.rotation,
    scale: { x: item.scale.x, y: item.scale.y },
    imageOffset: { x: item.imageOffset.x, y: item.imageOffset.y },
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    imageDpi: item.imageDpi,
    sceneDpi: scene.grid.dpi,
  };
  const { cols, rows } = displayGrid(placement);
  if (cols < 1 || rows < 1) {
    throw new MapSelectionError(
      `${item.name} covers less than one grid cell; check its grid dpi in Owlbear.`,
    );
  }
  const registration: MapRegistration = {
    itemId: item.id,
    name: item.name,
    placement,
  };
  maps.registerMap(registration);
  return { map: registration, cols, rows };
}

/** The one map the request names, or the only map when no name is given. */
function chooseMap(
  scene: TableSceneMap,
  name: string | undefined,
): TableMapItem {
  const { maps } = scene;
  const names = maps.map((m) => m.name).join(", ");
  if (maps.length === 0) {
    throw new MapSelectionError(
      "There is no map on the scene: add the map image to the Map layer in Owlbear first.",
    );
  }
  if (name === undefined) {
    const [only] = maps;
    if (maps.length === 1 && only) return only;
    throw new MapSelectionError(
      `There are several maps on the scene; say which one: ${names}.`,
    );
  }
  const wanted = name.toLowerCase();
  const matches = maps.filter((m) => m.name.toLowerCase() === wanted);
  const [match] = matches;
  if (matches.length === 1 && match) return match;
  if (matches.length === 0) {
    throw new MapSelectionError(
      `No map named "${name}" on the scene; maps: ${names}.`,
    );
  }
  throw new MapSelectionError(
    `Several maps on the scene are named "${name}"; rename one in Owlbear. Maps: ${names}.`,
  );
}
