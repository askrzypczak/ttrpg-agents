import type { Point, Polygon } from "./types.js";

function onSegment(p: Point, a: Point, b: Point): boolean {
  const tolerance = 1e-9 * Math.max(1, Math.abs(p.x), Math.abs(p.y));
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared),
        );
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby)) <= tolerance;
}

/** Whether `p` is inside `polygon`; a point on an edge or vertex is inside. */
export function pointInPolygon(p: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (onSegment(p, a, b)) return true;
    const straddles = a.y > p.y !== b.y > p.y;
    const crossesRight = p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (straddles && crossesRight) {
      inside = !inside;
    }
  }
  return inside;
}
