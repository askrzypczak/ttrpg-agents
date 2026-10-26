import type { Room } from "./rooms.js";
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

/**
 * Picks up to `count` free `footprint` x `footprint` blocks of cells inside the
 * room, spread apart: the free block nearest the middle of the room first, then
 * farthest-point sampling. Ties go to the first block in scene order (rows,
 * then columns). When the spread fits fewer blocks than asked, the room is
 * packed in scene order (first fit) instead if that places more.
 */
export function pickFreeCells(input: {
  placement: MapPlacement;
  room: Room;
  occupied: readonly Cell[];
  count: number;
  footprint: number;
}): CellPick[] {
  void input;
  throw new Error("not implemented");
}
