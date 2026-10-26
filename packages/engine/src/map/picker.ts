import { cellCenter, sceneToCell } from "./cells.js";
import { roomContains, type Room } from "./rooms.js";
import { mapTransform } from "./transform.js";
import type { Cell, MapPlacement, Point } from "./types.js";

/**
 * A free block of scene cells: `cells` in scene order (rows, then columns; one
 * cell for footprint 1) and `position`, the block's centre in scene units (a
 * cell centre for an odd footprint, a grid intersection for an even one).
 */
export interface CellPick {
  cells: Cell[];
  position: Point;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

/** Every scene cell whose centre is inside the room, in scene order. */
function cellsInRoom(placement: MapPlacement, room: Room): Cell[] {
  const transform = mapTransform(placement);
  const vertices = room.polygons.flat().map((p) => transform.imageToScene(p));
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const min = sceneToCell(
    { x: Math.min(...xs), y: Math.min(...ys) },
    placement.sceneDpi,
  );
  const max = sceneToCell(
    { x: Math.max(...xs), y: Math.max(...ys) },
    placement.sceneDpi,
  );
  const cells: Cell[] = [];
  for (let row = min.row; row <= max.row; row++) {
    for (let col = min.col; col <= max.col; col++) {
      const cell = { col, row };
      const centre = cellCenter(cell, placement.sceneDpi);
      if (roomContains(room, transform.sceneToImage(centre))) cells.push(cell);
    }
  }
  return cells;
}

/**
 * Every n x n block whose cells are all in the room and free, in scene order
 * of its top-left cell.
 */
function freeBlocks(
  inRoom: readonly Cell[],
  occupied: readonly Cell[],
  n: number,
  sceneDpi: number,
): CellPick[] {
  const roomCells = new Set(inRoom.map(cellKey));
  const taken = new Set(occupied.map(cellKey));
  const blocks: CellPick[] = [];
  for (const anchor of inRoom) {
    const cells: Cell[] = [];
    for (let row = anchor.row; row < anchor.row + n; row++) {
      for (let col = anchor.col; col < anchor.col + n; col++) {
        const key = cellKey({ col, row });
        if (roomCells.has(key) && !taken.has(key)) cells.push({ col, row });
      }
    }
    if (cells.length !== n * n) continue;
    blocks.push({
      cells,
      position: {
        x: (anchor.col + n / 2) * sceneDpi,
        y: (anchor.row + n / 2) * sceneDpi,
      },
    });
  }
  return blocks;
}

/** Whether two n x n blocks share a cell, compared by their top-left cells. */
function overlaps(a: CellPick, b: CellPick, n: number): boolean {
  const ca = a.cells[0] as Cell;
  const cb = b.cells[0] as Cell;
  return Math.abs(ca.col - cb.col) < n && Math.abs(ca.row - cb.row) < n;
}

/**
 * Farthest-point sampling: the candidate nearest `mean` first, then each time
 * the non-overlapping candidate farthest from every block picked so far.
 */
function spread(
  candidates: readonly CellPick[],
  mean: Point,
  count: number,
  n: number,
): CellPick[] {
  let seed = candidates[0] as CellPick;
  for (const candidate of candidates) {
    if (distance(candidate.position, mean) < distance(seed.position, mean)) {
      seed = candidate;
    }
  }
  const picked: CellPick[] = [seed];
  const minDistance = candidates.map((c) =>
    distance(c.position, seed.position),
  );
  const blocked = candidates.map((c) => overlaps(c, seed, n));
  while (picked.length < count) {
    let best = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (blocked[i] === true) continue;
      if (
        best === -1 ||
        (minDistance[i] as number) > (minDistance[best] as number)
      ) {
        best = i;
      }
    }
    if (best === -1) break;
    const next = candidates[best] as CellPick;
    picked.push(next);
    candidates.forEach((c, i) => {
      minDistance[i] = Math.min(
        minDistance[i] as number,
        distance(c.position, next.position),
      );
      if (overlaps(c, next, n)) blocked[i] = true;
    });
  }
  return picked;
}

/** First fit in scene order: each candidate that overlaps no earlier pick. */
function pack(
  candidates: readonly CellPick[],
  count: number,
  n: number,
): CellPick[] {
  const picked: CellPick[] = [];
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => !overlaps(p, candidate, n))) picked.push(candidate);
  }
  return picked;
}

/**
 * Picks up to `count` free `footprint` x `footprint` blocks of cells inside the
 * room. A cell is in the room when its centre is; a block is a candidate when
 * all its cells are in the room and none is in `occupied`; picked blocks never
 * overlap. The picks are spread apart: the candidate whose centre is nearest
 * the mean of the room's cell centres first, then farthest-point sampling
 * between block centres. Ties go to the first block in scene order (rows,
 * then columns, of its top-left cell). When the spread fits fewer blocks than
 * asked, the room is packed in scene order (first fit) instead if that places
 * more.
 */
export function pickFreeCells(input: {
  placement: MapPlacement;
  room: Room;
  occupied: readonly Cell[];
  count: number;
  footprint: number;
}): CellPick[] {
  if (input.count <= 0) return [];
  const { sceneDpi } = input.placement;
  const n = input.footprint;
  const inRoom = cellsInRoom(input.placement, input.room);
  const candidates = freeBlocks(inRoom, input.occupied, n, sceneDpi);
  if (candidates.length === 0) return [];

  const centres = inRoom.map((c) => cellCenter(c, sceneDpi));
  const mean: Point = {
    x: centres.reduce((sum, c) => sum + c.x, 0) / centres.length,
    y: centres.reduce((sum, c) => sum + c.y, 0) / centres.length,
  };
  const spreadPicks = spread(candidates, mean, input.count, n);
  if (spreadPicks.length >= input.count) return spreadPicks;
  const packed = pack(candidates, input.count, n);
  return packed.length > spreadPicks.length ? packed : spreadPicks;
}
