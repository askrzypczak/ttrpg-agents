import type { Point } from "../map/types.js";

/** What the table reports about its scene. */
export interface TableSceneStatus {
  sceneReady: boolean;
  tokenCount: number;
  appliedInstanceCount: number;
}

/** One map image on the table, with its image grid and transform. */
export interface TableMapItem {
  id: string;
  name: string;
  imageWidth: number;
  imageHeight: number;
  imageDpi: number;
  imageOffset: Point;
  position: Point;
  rotation: number;
  scale: Point;
}

/** The table's scene grid and the map images on it. */
export interface TableSceneMap {
  grid: { dpi: number; type: string };
  maps: TableMapItem[];
}

/**
 * An item on the table's CHARACTER or MOUNT layer, at a position in scene
 * units.
 */
export interface TableToken {
  position: Point;
}

/** The items on the table's CHARACTER and MOUNT layers. */
export interface TableSceneTokens {
  tokens: TableToken[];
}

/**
 * One map image drawn as the DM sees it, with the display grid and its
 * labels: the encoded bytes as base64 and the picture's size in px.
 */
export interface TableMapImage {
  mimeType: "image/webp" | "image/jpeg";
  data: string;
  width: number;
  height: number;
}

/** Driven port: ask the table (the VTT). Fails with `TableUnavailableError`. */
export interface TablePort {
  sceneStatus(): Promise<TableSceneStatus>;
  /** The scene grid and map images. Fails with `TableUnavailableError`. */
  sceneMap(): Promise<TableSceneMap>;
  /**
   * The position of each item on the CHARACTER and MOUNT layers. Fails with
   * `TableUnavailableError`.
   */
  sceneTokens(): Promise<TableSceneTokens>;
  /**
   * The map image with this item id, drawn as the DM sees it with the display
   * grid and its labels. Fails with `TableUnavailableError`.
   */
  mapImage(itemId: string): Promise<TableMapImage>;
}
