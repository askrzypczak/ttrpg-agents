import type { Point, Polygon } from "./types.js";

/** Whether `p` is inside `polygon`; a point on an edge or vertex is inside. */
export function pointInPolygon(p: Point, polygon: Polygon): boolean {
  void p;
  void polygon;
  throw new Error("not implemented");
}
