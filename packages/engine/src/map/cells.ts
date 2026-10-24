import type { Cell, Point } from "./types.js";

export function sceneToCell(p: Point, sceneDpi: number): Cell {
  void p;
  void sceneDpi;
  throw new Error("not implemented");
}

export function cellCenter(cell: Cell, sceneDpi: number): Point {
  void cell;
  void sceneDpi;
  throw new Error("not implemented");
}
