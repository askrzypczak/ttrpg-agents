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

/**
 * Sine and cosine of a clockwise rotation in degrees. Multiples of 90 degrees
 * are exact: Math.cos(270 degrees) is -1.8e-16, which would push a point on a
 * cell line into the neighbouring cell.
 */
function sinCos(degrees: number): { sin: number; cos: number } {
  const normalised = ((degrees % 360) + 360) % 360;
  switch (normalised) {
    case 0:
      return { sin: 0, cos: 1 };
    case 90:
      return { sin: 1, cos: 0 };
    case 180:
      return { sin: 0, cos: -1 };
    case 270:
      return { sin: -1, cos: 0 };
    default: {
      const radians = (normalised * Math.PI) / 180;
      return { sin: Math.sin(radians), cos: Math.cos(radians) };
    }
  }
}

/**
 * scene = position + R(rotation) * (diag(scale) * k * (image - imageOffset)),
 * with k = sceneDpi / imageDpi and rotation clockwise about `position` (y down).
 */
export function mapTransform(placement: MapPlacement): MapTransform {
  const { position, scale, imageOffset, imageDpi, sceneDpi } = placement;
  const { sin, cos } = sinCos(placement.rotation);

  const imageToScene = (p: Point): Point => {
    const dx = ((p.x - imageOffset.x) * scale.x * sceneDpi) / imageDpi;
    const dy = ((p.y - imageOffset.y) * scale.y * sceneDpi) / imageDpi;
    return {
      x: dx * cos - dy * sin + position.x,
      y: dx * sin + dy * cos + position.y,
    };
  };

  const sceneToImage = (p: Point): Point => {
    const rx = p.x - position.x;
    const ry = p.y - position.y;
    const dx = rx * cos + ry * sin;
    const dy = -rx * sin + ry * cos;
    return {
      x: (dx * imageDpi) / sceneDpi / scale.x + imageOffset.x,
      y: (dy * imageDpi) / sceneDpi / scale.y + imageOffset.y,
    };
  };

  const corners = {
    topLeft: imageToScene({ x: 0, y: 0 }),
    topRight: imageToScene({ x: placement.imageWidth, y: 0 }),
    bottomLeft: imageToScene({ x: 0, y: placement.imageHeight }),
    bottomRight: imageToScene({
      x: placement.imageWidth,
      y: placement.imageHeight,
    }),
  };
  const all = Object.values(corners);
  const xs = all.map((c) => c.x);
  const ys = all.map((c) => c.y);

  return {
    imageToScene,
    sceneToImage,
    corners,
    bounds: {
      min: { x: Math.min(...xs), y: Math.min(...ys) },
      max: { x: Math.max(...xs), y: Math.max(...ys) },
    },
  };
}
