import type { Room } from "./rooms.js";
import type { Cell, MapPlacement, Point } from "./types.js";

/** An absolute scene cell and its centre in scene units. */
export interface CellPick {
  cell: Cell;
  position: Point;
}

export function pickFreeCells(input: {
  placement: MapPlacement;
  room: Room;
  occupied: readonly Cell[];
  count: number;
}): CellPick[] {
  void input;
  throw new Error("not implemented");
}
