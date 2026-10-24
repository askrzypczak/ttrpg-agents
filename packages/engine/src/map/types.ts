/** A 2D point: image pixels or scene units, by context. */
export interface Point {
  x: number;
  y: number;
}

/** An integer grid cell: an absolute scene cell or a display cell, by context. */
export interface Cell {
  col: number;
  row: number;
}

/**
 * Where a map image sits in the scene. Rotation is in degrees clockwise
 * (y down) about `position`; `imageOffset` is the image pixel anchored at
 * `position`.
 */
export interface MapPlacement {
  position: Point;
  rotation: number;
  scale: Point;
  imageOffset: Point;
  imageWidth: number;
  imageHeight: number;
  imageDpi: number;
  sceneDpi: number;
}

/** A closed polygon (the last vertex joins the first). */
export type Polygon = Point[];
