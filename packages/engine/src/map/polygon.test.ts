import { describe, expect, it } from "vitest";
import { pointInPolygon } from "./polygon.js";
import type { Polygon } from "./types.js";

const SQUARE: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const TRIANGLE: Polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];

/** A 20x20 square with its bottom-right 10x10 quarter cut out. */
const L_SHAPE: Polygon = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];

describe("pointInPolygon", () => {
  it("includes interior points and excludes exterior points", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 9.9 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: 11, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -0.1 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 10.1 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: 20, y: 20 }, SQUARE)).toBe(false);
  });

  it("treats a point on an edge as inside", () => {
    expect(pointInPolygon({ x: 5, y: 0 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 5 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 10 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 5 }, SQUARE)).toBe(true);
    // On the hypotenuse x + y = 10.
    expect(pointInPolygon({ x: 5, y: 5 }, TRIANGLE)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 6 }, TRIANGLE)).toBe(false);
  });

  it("treats a point on a vertex as inside", () => {
    for (const vertex of SQUARE) {
      expect(pointInPolygon(vertex, SQUARE)).toBe(true);
    }
    expect(pointInPolygon({ x: 0, y: 10 }, TRIANGLE)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 0 }, TRIANGLE)).toBe(true);
  });

  it("handles a concave (L-shaped) polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 15 }, L_SHAPE)).toBe(true);
    // The cut-out quarter and beyond the arms.
    expect(pointInPolygon({ x: 15, y: 15 }, L_SHAPE)).toBe(false);
    expect(pointInPolygon({ x: 25, y: 5 }, L_SHAPE)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 25 }, L_SHAPE)).toBe(false);
    // The reflex vertex and an edge of the cut-out.
    expect(pointInPolygon({ x: 10, y: 10 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 10 }, L_SHAPE)).toBe(true);
  });
});
