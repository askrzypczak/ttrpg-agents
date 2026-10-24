import type { MapPlacement, Point } from "./types.js";

/** Image px <-> scene units for one map placement. */
export interface MapTransform {
  imageToScene(p: Point): Point;
  sceneToImage(p: Point): Point;
  corners: {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
  };
  bounds: { min: Point; max: Point };
}

export function mapTransform(placement: MapPlacement): MapTransform {
  void placement;
  throw new Error("not implemented");
}
