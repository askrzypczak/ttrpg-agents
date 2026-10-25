import type { Cell, Point } from "./types.js";

/** Snaps values within float noise of a cell line onto it before flooring. */
function floorCell(value: number): number {
  const nearest = Math.round(value);
  const snap = Math.abs(value - nearest) < 1e-9;
  return (snap ? nearest : Math.floor(value)) + 0;
}

/** The absolute scene cell holding `p`; a point on a cell line is in the cell it starts. */
export function sceneToCell(p: Point, sceneDpi: number): Cell {
  return { col: floorCell(p.x / sceneDpi), row: floorCell(p.y / sceneDpi) };
}

/** The centre of an absolute scene cell, in scene units. */
export function cellCenter(cell: Cell, sceneDpi: number): Point {
  return { x: (cell.col + 0.5) * sceneDpi, y: (cell.row + 0.5) * sceneDpi };
}
