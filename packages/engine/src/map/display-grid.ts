import type { Cell, MapPlacement, Polygon } from "./types.js";

/** The labelled grid shown over a map, in display cells (0-based). */
export interface DisplayGrid {
  cols: number;
  rows: number;
  origin: Cell;
  sceneCellToDisplay(cell: Cell): Cell;
  displayToSceneCell(cell: Cell): Cell;
}

/** An inclusive range of display cells, normalised so from <= to. */
export interface CellRange {
  from: Cell;
  to: Cell;
}

export function displayGrid(placement: MapPlacement): DisplayGrid {
  void placement;
  throw new Error("not implemented");
}

export function formatCellLabel(cell: Cell): string {
  void cell;
  throw new Error("not implemented");
}

export function parseCellLabel(label: string): Cell {
  void label;
  throw new Error("not implemented");
}

export function parseCellRange(text: string): CellRange {
  void text;
  throw new Error("not implemented");
}

export function formatCellRange(range: CellRange): string {
  void range;
  throw new Error("not implemented");
}

export function cellRangeToPolygon(
  placement: MapPlacement,
  range: CellRange,
): Polygon {
  void placement;
  void range;
  throw new Error("not implemented");
}

export function polygonToCellRange(
  placement: MapPlacement,
  polygon: Polygon,
): CellRange | undefined {
  void placement;
  void polygon;
  throw new Error("not implemented");
}
