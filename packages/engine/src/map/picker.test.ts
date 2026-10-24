import { describe, expect, it } from "vitest";
import {
  pickFreeCells,
  type Cell,
  type CellPick,
  type MapPlacement,
  type Polygon,
  type Room,
} from "../index.js";

/** Unrotated, unscaled, image px = scene units, 100-unit cells. */
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

/** Cells of a FLAT room: centres at ((col + 0.5) * 100, (row + 0.5) * 100). */
const STRIP_3 = room(rect(0, 0, 300, 100)); // cols 0..2, row 0
const STRIP_5 = room(rect(0, 0, 500, 100)); // cols 0..4, row 0
const SQUARE_3 = room(rect(0, 0, 300, 300)); // cols 0..2, rows 0..2

function cells(picks: CellPick[]): Cell[] {
  return picks.map((p) => p.cell);
}

/** Cells in scene order (rows, then columns), for order-free comparison. */
function sorted(list: Cell[]): Cell[] {
  return [...list].sort((a, b) => a.row - b.row || a.col - b.col);
}

describe("pickFreeCells", () => {
  it("picks cells whose centre is inside the room, at the cell centre position", () => {
    // 50 image dpi on a 100-unit grid: k = 2, so image 0..100 is scene
    // 0..200, cells (0..1, 0..1) with centres at 50 and 150.
    const picks = pickFreeCells({
      placement: { ...FLAT, imageDpi: 50 },
      room: room(rect(0, 0, 100, 100)),
      occupied: [],
      count: 4,
    });
    expect(sorted(cells(picks))).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ]);
    for (const pick of picks) {
      expect(pick.position).toEqual({
        x: (pick.cell.col + 0.5) * 100,
        y: (pick.cell.row + 0.5) * 100,
      });
    }
  });

  it("skips occupied cells", () => {
    const picks = pickFreeCells({
      placement: FLAT,
      room: STRIP_3,
      occupied: [{ col: 1, row: 0 }],
      count: 2,
    });
    expect(sorted(cells(picks))).toEqual([
      { col: 0, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns distinct picks", () => {
    const picks = pickFreeCells({
      placement: FLAT,
      room: SQUARE_3,
      occupied: [],
      count: 5,
    });
    expect(picks).toHaveLength(5);
    const keys = new Set(picks.map((p) => `${p.cell.col},${p.cell.row}`));
    expect(keys.size).toBe(5);
    for (const { cell } of picks) {
      expect(
        cell.col >= 0 && cell.col <= 2 && cell.row >= 0 && cell.row <= 2,
      ).toBe(true);
    }
  });

  it("spreads picks apart (farthest point), the first pick near the middle of the room (hand-derived expected cells, ties to the first in scene order)", () => {
    // 3x3 square: mean of centres (150, 150) is cell (1,1)'s centre -> seed (1,1).
    // Farthest from (1,1): the four corners tie at 141 -> first in scene order (0,0).
    // Max-min distance to {(1,1),(0,0)}: (2,0), (0,2), (2,2) tie at 141
    // (edge cells reach only 100) -> (2,0), row 0 first.
    // Max-min to {(1,1),(0,0),(2,0)}: (0,2) and (2,2) tie at 141 -> (0,2).
    expect(
      cells(
        pickFreeCells({
          placement: FLAT,
          room: SQUARE_3,
          occupied: [],
          count: 4,
        }),
      ),
    ).toEqual([
      { col: 1, row: 1 },
      { col: 0, row: 0 },
      { col: 2, row: 0 },
      { col: 0, row: 2 },
    ]);

    // 5x1 strip: mean (250, 50) -> seed col 2. Farthest: cols 0 and 4 tie at
    // 200 -> col 0. Then min distances: col 1: 100, col 3: 100, col 4: 200 -> col 4.
    expect(
      cells(
        pickFreeCells({
          placement: FLAT,
          room: STRIP_5,
          occupied: [],
          count: 3,
        }),
      ),
    ).toEqual([
      { col: 2, row: 0 },
      { col: 0, row: 0 },
      { col: 4, row: 0 },
    ]);

    // The seed uses the mean of every cell in the room, occupied or not:
    // with cols 0 and 1 occupied the mean is still (250, 50) -> seed col 2
    // (not col 3, nearest the free cells' mean 350). Then col 4 (200) over col 3 (100).
    expect(
      cells(
        pickFreeCells({
          placement: FLAT,
          room: STRIP_5,
          occupied: [
            { col: 0, row: 0 },
            { col: 1, row: 0 },
          ],
          count: 2,
        }),
      ),
    ).toEqual([
      { col: 2, row: 0 },
      { col: 4, row: 0 },
    ]);
  });

  it("returns fewer picks when the room is too small for the count", () => {
    const picks = pickFreeCells({
      placement: FLAT,
      room: STRIP_3,
      occupied: [],
      count: 5,
    });
    expect(sorted(cells(picks))).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it("returns nothing when every cell is occupied", () => {
    expect(
      pickFreeCells({
        placement: FLAT,
        room: STRIP_3,
        occupied: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
          { col: 2, row: 0 },
        ],
        count: 2,
      }),
    ).toEqual([]);
  });

  it("picks across both polygons of an L-shaped room", () => {
    // Arm A: cells (0,0), (1,0); arm B: cells (0,1), (0,2).
    const lRoom = room(rect(0, 0, 200, 100), rect(0, 100, 100, 300));
    expect(
      sorted(
        cells(
          pickFreeCells({
            placement: FLAT,
            room: lRoom,
            occupied: [],
            count: 4,
          }),
        ),
      ),
    ).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ]);
    // Mean of centres: x (50 + 150 + 50 + 50) / 4 = 75, y (50 + 50 + 150 + 250) / 4 = 125.
    // Nearest: (0,1) at (50,150), distance ~35 -> seed. Farthest from it:
    // (1,0) at 141 beats (0,0) and (0,2) at 100.
    expect(
      cells(
        pickFreeCells({ placement: FLAT, room: lRoom, occupied: [], count: 2 }),
      ),
    ).toEqual([
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ]);
  });

  it("picks inside a room under a rotated map", () => {
    // Trollskull maps image (u, v) to scene (1.2v, -1.2u). Image u 2375..2500,
    // v 2375..2625 is scene x 2850..3150, y -3000..-2850: centres of scene
    // cells (19, -20) at (2925, -2925) and (20, -20) at (3075, -2925) only.
    // Their mean (3000, -2925) is equidistant -> (19, -20) first in scene order.
    const picks = pickFreeCells({
      placement: TROLLSKULL,
      room: room(rect(2375, 2375, 2500, 2625)),
      occupied: [],
      count: 3,
    });
    expect(picks).toEqual([
      { cell: { col: 19, row: -20 }, position: { x: 2925, y: -2925 } },
      { cell: { col: 20, row: -20 }, position: { x: 3075, y: -2925 } },
    ]);
  });

  it("returns nothing for a count of zero", () => {
    expect(
      pickFreeCells({
        placement: FLAT,
        room: SQUARE_3,
        occupied: [],
        count: 0,
      }),
    ).toEqual([]);
  });
});
