import { cellCenter, sceneToCell } from "./cells.js";
import { InvalidCellRangeError } from "./errors.js";
import { pointInPolygon } from "./polygon.js";
import { mapTransform } from "./transform.js";
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

/** Display grid: anchored at the scene cell holding the map's top-left bounds corner. */
export function displayGrid(placement: MapPlacement): DisplayGrid {
  const { bounds } = mapTransform(placement);
  const { sceneDpi } = placement;
  // Nudge so a corner within float noise below a cell line lands in that cell.
  const origin = sceneToCell(
    { x: bounds.min.x + 1e-6, y: bounds.min.y + 1e-6 },
    sceneDpi,
  );
  return {
    cols: Math.round((bounds.max.x - bounds.min.x) / sceneDpi),
    rows: Math.round((bounds.max.y - bounds.min.y) / sceneDpi),
    origin,
    sceneCellToDisplay: (cell) => ({
      col: cell.col - origin.col,
      row: cell.row - origin.row,
    }),
    displayToSceneCell: (cell) => ({
      col: cell.col + origin.col,
      row: cell.row + origin.row,
    }),
  };
}

/** Spreadsheet-style column letters: 0 is A, 25 is Z, 26 is AA. */
export function formatColumnLabel(col: number): string {
  void col;
  throw new Error("not implemented");
}

/** Spreadsheet-style label: column A, B, ..., Z, AA, ...; the row is 1-based. */
export function formatCellLabel(cell: Cell): string {
  let letters = "";
  for (let n = cell.col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${cell.row + 1}`;
}

/** Parses a label such as "T5" or "ab11" (case-insensitive) to a display cell. */
export function parseCellLabel(label: string): Cell {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(label);
  if (!match) {
    throw new InvalidCellRangeError(
      `Invalid cell label "${label}"; expected a column and a row such as "T5".`,
    );
  }
  let col = 0;
  for (const letter of (match[1] as string).toUpperCase()) {
    col = col * 26 + (letter.charCodeAt(0) - 64);
  }
  return { col: col - 1, row: Number(match[2]) - 1 };
}

/** Parses "T5:AB11" (either corner order) or a single cell "T5" to a range. */
export function parseCellRange(text: string): CellRange {
  const parts = text.split(":");
  if (parts.length > 2) {
    throw new InvalidCellRangeError(
      `Invalid cell range "${text}"; expected a cell or two cells such as "T5:AB11".`,
    );
  }
  const a = parseCellLabel(parts[0] as string);
  const b = parseCellLabel(parts[1] ?? (parts[0] as string));
  return {
    from: { col: Math.min(a.col, b.col), row: Math.min(a.row, b.row) },
    to: { col: Math.max(a.col, b.col), row: Math.max(a.row, b.row) },
  };
}

/** Formats a range as "T5:AB11", or "T5" for a single cell. */
export function formatCellRange(range: CellRange): string {
  const from = formatCellLabel(range.from);
  const to = formatCellLabel(range.to);
  return from === to ? from : `${from}:${to}`;
}

/** The range's rectangle as four image-px corners, in order around it. */
export function cellRangeToPolygon(
  placement: MapPlacement,
  range: CellRange,
): Polygon {
  const grid = displayGrid(placement);
  const transform = mapTransform(placement);
  const first = grid.displayToSceneCell(range.from);
  const last = grid.displayToSceneCell(range.to);
  const { sceneDpi } = placement;
  const left = first.col * sceneDpi;
  const top = first.row * sceneDpi;
  const right = (last.col + 1) * sceneDpi;
  const bottom = (last.row + 1) * sceneDpi;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ].map((p) => transform.sceneToImage(p));
}

/** The smallest range of display cells whose centres are inside the polygon (image px). */
export function polygonToCellRange(
  placement: MapPlacement,
  polygon: Polygon,
): CellRange | undefined {
  const grid = displayGrid(placement);
  const transform = mapTransform(placement);
  const { sceneDpi } = placement;
  const scene = polygon.map((p) => transform.imageToScene(p));
  const xs = scene.map((p) => p.x);
  const ys = scene.map((p) => p.y);
  const min = sceneToCell({ x: Math.min(...xs), y: Math.min(...ys) }, sceneDpi);
  const max = sceneToCell({ x: Math.max(...xs), y: Math.max(...ys) }, sceneDpi);
  let range: CellRange | undefined;
  for (let row = min.row; row <= max.row; row++) {
    for (let col = min.col; col <= max.col; col++) {
      const centre = cellCenter({ col, row }, sceneDpi);
      if (!pointInPolygon(transform.sceneToImage(centre), polygon)) continue;
      const display = grid.sceneCellToDisplay({ col, row });
      range = range
        ? {
            from: {
              col: Math.min(range.from.col, display.col),
              row: Math.min(range.from.row, display.row),
            },
            to: {
              col: Math.max(range.to.col, display.col),
              row: Math.max(range.to.row, display.row),
            },
          }
        : { from: display, to: display };
    }
  }
  return range;
}
