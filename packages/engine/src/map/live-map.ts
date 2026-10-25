import type { TableMapItem, TablePort, TableSceneMap } from "../table/port.js";
import { MapSelectionError, UnsupportedGridError } from "./errors.js";
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
  const map = maps.getActiveMap();
  if (!map) throw new MapSelectionError("No map is in use: use the map first.");
  return map;
}

/** UnsupportedGridError unless the scene grid is SQUARE (message moved from useMap). */
export function requireSquareGrid(scene: TableSceneMap): void {
  if (scene.grid.type !== "SQUARE") {
    throw new UnsupportedGridError(
      `Only square grids are supported; this scene's grid is ${scene.grid.type}.`,
    );
  }
}

/** The item's placement on the scene grid (moved from useMap). */
export function scenePlacement(
  scene: TableSceneMap,
  item: TableMapItem,
): MapPlacement {
  return {
    position: { x: item.position.x, y: item.position.y },
    rotation: item.rotation,
    scale: { x: item.scale.x, y: item.scale.y },
    imageOffset: { x: item.imageOffset.x, y: item.imageOffset.y },
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    imageDpi: item.imageDpi,
    sceneDpi: scene.grid.dpi,
  };
}

/** Active map, then the table's live placement of its item; fails when the item is gone or the grid is not square. */
export async function liveActiveMap(
  table: Pick<TablePort, "sceneMap">,
  maps: Pick<MapRepository, "getActiveMap">,
): Promise<LiveMap> {
  const map = requireActiveMap(maps);
  const scene = await table.sceneMap();
  requireSquareGrid(scene);
  const item = scene.maps.find((m) => m.id === map.itemId);
  if (!item) {
    throw new MapSelectionError(
      `${map.name} is no longer on the scene: use the map again.`,
    );
  }
  const placement = scenePlacement(scene, item);
  return { map, placement, moved: !samePlacement(map.placement, placement) };
}

/** Whether every field of the two placements is exactly equal. */
function samePlacement(a: MapPlacement, b: MapPlacement): boolean {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.rotation === b.rotation &&
    a.scale.x === b.scale.x &&
    a.scale.y === b.scale.y &&
    a.imageOffset.x === b.imageOffset.x &&
    a.imageOffset.y === b.imageOffset.y &&
    a.imageWidth === b.imageWidth &&
    a.imageHeight === b.imageHeight &&
    a.imageDpi === b.imageDpi &&
    a.sceneDpi === b.sceneDpi
  );
}
