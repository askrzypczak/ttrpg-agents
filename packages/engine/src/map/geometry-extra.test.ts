import { describe, expect, it } from "vitest";
import {
  displayGrid,
  formatCellRange,
  mapTransform,
  pickFreeCells,
  polygonToCellRange,
  sceneToCell,
  type MapPlacement,
  type Polygon,
  type Room,
} from "../index.js";
import { pointInPolygon } from "./polygon.js";

const FLAT: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 1000,
  imageHeight: 1000,
  imageDpi: 100,
  sceneDpi: 100,
};

function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function room(...polygons: Polygon[]): Room {
  return { name: "Room", polygons };
}

describe("mapTransform rotation", () => {
  it("rotates 45 degrees clockwise with y down", () => {
    const t = mapTransform({
      ...FLAT,
      rotation: 45,
    });
    const point = t.imageToScene({ x: 100, y: 0 });
    expect(point.x).toBeCloseTo(100 * Math.SQRT1_2, 9);
    expect(point.y).toBeCloseTo(100 * Math.SQRT1_2, 9);
  });
});

describe("sceneToCell snapping", () => {
  it("treats a point a hair below a cell line as on the line", () => {
    expect(sceneToCell({ x: 3 - 1e-10, y: 5 - 1e-10 }, 1)).toEqual({
      col: 3,
      row: 5,
    });
  });

  it("returns positive zero for a point a hair below zero", () => {
    const cell = sceneToCell({ x: -1e-12, y: -1e-12 }, 150);
    expect(Object.is(cell.col, 0)).toBe(true);
    expect(Object.is(cell.row, 0)).toBe(true);
  });
});

describe("display grid with an offset origin", () => {
  it("converts between scene and display cells in both directions", () => {
    const grid = displayGrid({
      ...FLAT,
      position: { x: 300, y: 500 },
    });
    expect(grid.origin).toEqual({ col: 3, row: 5 });
    expect(grid.sceneCellToDisplay({ col: 7, row: 9 })).toEqual({
      col: 4,
      row: 4,
    });
    expect(grid.displayToSceneCell({ col: 4, row: 4 })).toEqual({
      col: 7,
      row: 9,
    });
  });
});

describe("formatCellRange", () => {
  it("formats a single cell without a colon", () => {
    const cell = { col: 19, row: 4 };
    expect(formatCellRange({ from: cell, to: cell })).toBe("T5");
  });
});

describe("polygonToCellRange edges", () => {
  it("includes cells in the last row and column of the polygon's box", () => {
    // Cell centres 50 and 150 are inside; 150 is in the box's last cell.
    expect(polygonToCellRange(FLAT, rect(0, 0, 160, 160))).toEqual({
      from: { col: 0, row: 0 },
      to: { col: 1, row: 1 },
    });
  });

  it("returns undefined for an empty polygon", () => {
    expect(polygonToCellRange(FLAT, [])).toBeUndefined();
  });
});

describe("pointInPolygon", () => {
  const triangle: Polygon = [
    { x: 2, y: 2 },
    { x: 12, y: 4 },
    { x: 6, y: 12 },
  ];

  it("separates points either side of slanted edges", () => {
    expect(pointInPolygon({ x: 4, y: 6 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 6 }, triangle)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 6 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 6 }, triangle)).toBe(false);
  });

  it("handles a ray passing exactly through vertices", () => {
    const diamond: Polygon = [
      { x: 0, y: 5 },
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon({ x: 7, y: 5 }, diamond)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 5 }, diamond)).toBe(true);
    expect(pointInPolygon({ x: 12, y: 5 }, diamond)).toBe(false);
    expect(pointInPolygon({ x: -2, y: 5 }, diamond)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 12 }, diamond)).toBe(false);
  });

  it("scales the edge tolerance with the coordinates", () => {
    const big = rect(0, 0, 2e6, 2e6);
    expect(pointInPolygon({ x: 1e6, y: -1e-4 }, big)).toBe(true);
    expect(pointInPolygon({ x: 1e6, y: -1 }, big)).toBe(false);
  });

  it("treats the only vertex of a degenerate polygon as inside", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, [{ x: 5, y: 5 }])).toBe(true);
  });
});

describe("pickFreeCells extras", () => {
  it("includes cells in the last row and column of the room's box", () => {
    const picks = pickFreeCells({
      placement: FLAT,
      room: room(rect(0, 0, 160, 160)),
      occupied: [],
      count: 4,
    });
    expect(picks).toHaveLength(4);
  });

  it("returns nothing for a room with no polygons", () => {
    expect(
      pickFreeCells({ placement: FLAT, room: room(), occupied: [], count: 2 }),
    ).toEqual([]);
  });

  it("keeps spreading away from every earlier pick, not only the first", () => {
    // Ten cells in a row: seed col 4, then col 9, col 0, then col 2 (the first
    // of cols 2, 6 and 7, all 200 from their nearest pick).
    const picks = pickFreeCells({
      placement: FLAT,
      room: room(rect(0, 0, 1000, 100)),
      occupied: [],
      count: 4,
    });
    expect(picks.map((p) => p.cell.col)).toEqual([4, 9, 0, 2]);
  });

  it("breaks a farthest-point tie toward the first cell in scene order", () => {
    // Cells (0,0), (2,0) and (1,1): the seed is (1,1); (0,0) and (2,0) tie.
    const picks = pickFreeCells({
      placement: FLAT,
      room: room(
        rect(0, 0, 100, 100),
        rect(200, 0, 300, 100),
        rect(100, 100, 200, 200),
      ),
      occupied: [],
      count: 2,
    });
    expect(picks.map((p) => p.cell)).toEqual([
      { col: 1, row: 1 },
      { col: 0, row: 0 },
    ]);
  });
});
