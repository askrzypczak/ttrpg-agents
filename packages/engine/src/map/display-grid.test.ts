import { describe, expect, it } from "vitest";
import {
  InvalidCellRangeError,
  cellRangeToPolygon,
  displayGrid,
  formatCellLabel,
  formatCellRange,
  formatColumnLabel,
  parseCellLabel,
  parseCellRange,
  polygonToCellRange,
  type CellRange,
  type MapPlacement,
  type Point,
} from "../index.js";

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const TROLLSKULL: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  sceneDpi: 150,
};

// Display grid geometry used below (k = 150 / 125 = 1.2, rotation 270 maps
// image (u, v) to scene (1.2v, -1.2u)): the map spans scene x 0..4800 and
// y -3600..0, so the display origin is scene cell (0, -24), 32 x 24 cells.

/** T5:AB11 as display cells: T is column 19, AB column 27, rows 4 and 10. */
const T5_AB11: CellRange = {
  from: { col: 19, row: 4 },
  to: { col: 27, row: 10 },
};

// T5:AB11 is scene cells cols 19..27, rows -24 + 4 = -20 .. -24 + 10 = -14:
// scene x 19 * 150 = 2850 .. 28 * 150 = 4200, y -20 * 150 = -3000 .. -13 * 150 = -1950.
// Back to image px: v = x / 1.2 gives 2375 .. 3500; u = -y / 1.2 gives 1625 .. 2500.
const T5_AB11_IMAGE_CORNERS: Point[] = [
  { x: 1625, y: 2375 },
  { x: 2500, y: 2375 },
  { x: 2500, y: 3500 },
  { x: 1625, y: 3500 },
];

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

describe("displayGrid", () => {
  it("Trollskull display grid is 32 columns by 24 rows", () => {
    const grid = displayGrid(TROLLSKULL);
    expect(grid.cols).toBe(32);
    expect(grid.rows).toBe(24);
  });

  it("converts Trollskull's top-left display cell to scene cell and back", () => {
    const grid = displayGrid(TROLLSKULL);
    expect(grid.displayToSceneCell({ col: 0, row: 0 })).toEqual({
      col: 0,
      row: -24,
    });
    expect(grid.sceneCellToDisplay({ col: 0, row: -24 })).toEqual({
      col: 0,
      row: 0,
    });
  });

  it("converts Trollskull's bottom-right display cell to scene cell and back", () => {
    const grid = displayGrid(TROLLSKULL);
    expect(grid.displayToSceneCell({ col: 31, row: 23 })).toEqual({
      col: 31,
      row: -1,
    });
    expect(grid.sceneCellToDisplay({ col: 31, row: -1 })).toEqual({
      col: 31,
      row: 23,
    });
  });

  it("anchors the display grid at the cell holding the map's top-left corner when the map is offset by a fraction of a cell", () => {
    // Unrotated 300x300 px at matching dpis, top-left at scene (75, -40):
    // that corner is in scene cell (floor(0.5), floor(-0.27)) = (0, -1),
    // and the map is 300 / 150 = 2 cells each way.
    const grid = displayGrid({
      position: { x: 75, y: -40 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      imageOffset: { x: 0, y: 0 },
      imageWidth: 300,
      imageHeight: 300,
      imageDpi: 150,
      sceneDpi: 150,
    });
    expect(grid.origin).toEqual({ col: 0, row: -1 });
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.displayToSceneCell({ col: 0, row: 0 })).toEqual({
      col: 0,
      row: -1,
    });
    expect(grid.sceneCellToDisplay({ col: 1, row: 0 })).toEqual({
      col: 1,
      row: 1,
    });
  });
});

describe("cell labels", () => {
  it("formatColumnLabel gives A for column 0, Z for 25, AA for 26 and AF for 31", () => {
    expect(formatColumnLabel(0)).toBe("A");
    expect(formatColumnLabel(25)).toBe("Z");
    expect(formatColumnLabel(26)).toBe("AA");
    expect(formatColumnLabel(31)).toBe("AF");
  });

  it("formats single-letter, Z, AA and later columns as labels", () => {
    expect(formatCellLabel({ col: 0, row: 0 })).toBe("A1");
    expect(formatCellLabel({ col: 19, row: 4 })).toBe("T5");
    expect(formatCellLabel({ col: 25, row: 9 })).toBe("Z10");
    expect(formatCellLabel({ col: 26, row: 0 })).toBe("AA1");
    expect(formatCellLabel({ col: 27, row: 10 })).toBe("AB11");
    expect(formatCellLabel({ col: 51, row: 0 })).toBe("AZ1");
    expect(formatCellLabel({ col: 52, row: 0 })).toBe("BA1");
    expect(formatCellLabel({ col: 701, row: 0 })).toBe("ZZ1");
    expect(formatCellLabel({ col: 702, row: 0 })).toBe("AAA1");
  });

  it("round-trips labels through parse, including two-letter columns", () => {
    expect(parseCellLabel("AB11")).toEqual({ col: 27, row: 10 });
    for (const col of [0, 1, 25, 26, 27, 51, 52, 701, 702]) {
      for (const row of [0, 4, 99]) {
        expect(parseCellLabel(formatCellLabel({ col, row }))).toEqual({
          col,
          row,
        });
      }
    }
  });

  it("parses labels case-insensitively", () => {
    expect(parseCellLabel("ab11")).toEqual({ col: 27, row: 10 });
    expect(parseCellLabel("aA1")).toEqual({ col: 26, row: 0 });
    expect(parseCellLabel("t5")).toEqual({ col: 19, row: 4 });
  });

  it("rejects malformed labels", () => {
    for (const bad of ["", "11", "AB", "Q0", "1A", "A-1", "A1.5", "A1:B2"]) {
      expect(() => parseCellLabel(bad), bad).toThrow(InvalidCellRangeError);
    }
    expect(() => parseCellLabel("Q0")).toThrow(/Q0/);
  });
});

describe("cell ranges", () => {
  it("parses and formats a cell range such as T5:AB11", () => {
    expect(parseCellRange("T5:AB11")).toEqual(T5_AB11);
    expect(formatCellRange(T5_AB11)).toBe("T5:AB11");
    expect(parseCellRange("T5")).toEqual({
      from: { col: 19, row: 4 },
      to: { col: 19, row: 4 },
    });
  });

  it("normalises a reversed range", () => {
    expect(parseCellRange("AB11:T5")).toEqual(T5_AB11);
    expect(parseCellRange("AB5:T11")).toEqual(T5_AB11);
    expect(parseCellRange("T11:AB5")).toEqual(T5_AB11);
  });

  it("rejects a malformed range", () => {
    for (const bad of [
      "",
      "T5:",
      ":AB11",
      "T5:AB11:C3",
      "T5-AB11",
      "T0:AB11",
    ]) {
      expect(() => parseCellRange(bad), bad).toThrow(InvalidCellRangeError);
    }
  });

  it("converts a cell range to an image-pixel polygon under rotation 270", () => {
    const polygon = cellRangeToPolygon(TROLLSKULL, T5_AB11);
    expect(polygon).toHaveLength(4);
    for (const corner of T5_AB11_IMAGE_CORNERS) {
      expect(
        polygon.some((p) => near(p.x, corner.x) && near(p.y, corner.y)),
        `${corner.x},${corner.y}`,
      ).toBe(true);
    }
    // In order around the rectangle: each edge is axis-aligned.
    polygon.forEach((p, i) => {
      const next = polygon[(i + 1) % polygon.length] as Point;
      expect(near(p.x, next.x) || near(p.y, next.y)).toBe(true);
    });
  });

  it("converts that polygon back to the same range under rotation 270", () => {
    expect(polygonToCellRange(TROLLSKULL, T5_AB11_IMAGE_CORNERS)).toEqual(
      T5_AB11,
    );
  });

  it("lists the smallest range holding every cell centre after the map is rescaled by 5%", () => {
    const rescaled: MapPlacement = {
      ...TROLLSKULL,
      scale: { x: 1.05, y: 1.05 },
    };
    const polygon = cellRangeToPolygon(TROLLSKULL, T5_AB11);
    // Rescaled: k * scale = 1.2 * 1.05 = 1.26, image (u, v) -> scene (1.26v, -1.26u).
    // The polygon (u 1625..2500, v 2375..3500) now spans scene
    // x 1.26 * 2375 = 2992.5 .. 1.26 * 3500 = 4410, y -1.26 * 2500 = -3150 .. -1.26 * 1625 = -2047.5.
    // Cell centres (c + 0.5) * 150 inside x: cols 20 (3075) .. 28 (4275);
    // col 19 (2925) and col 29 (4425) fall outside.
    // Inside y: rows -21 (-3075) .. -15 (-2175); rows -22 (-3225) and -14 (-2025) fall outside.
    // The rescaled map spans scene y -3780..0, so its display origin row is
    // floor(-3780 / 150) = floor(-25.2) = -26 (origin col 0).
    // Display cells: cols 20..28, rows -21 + 26 = 5 .. -15 + 26 = 11, i.e. U6:AC12.
    expect(polygonToCellRange(rescaled, polygon)).toEqual({
      from: { col: 20, row: 5 },
      to: { col: 28, row: 11 },
    });
  });

  it("returns undefined when no cell centre is inside the polygon", () => {
    // Image u, v 10..20 is scene x 12..24, y -24..-12: inside scene cell
    // (0, -1) but short of its centre (75, -75).
    const tiny: Point[] = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(polygonToCellRange(TROLLSKULL, tiny)).toBeUndefined();
  });
});
