import { cellCenter, sceneToCell } from "./cells.js";
import { roomContains, type Room } from "./rooms.js";
import { mapTransform } from "./transform.js";
import type { Cell, MapPlacement, Point } from "./types.js";

/** An absolute scene cell and its centre in scene units. */
export interface CellPick {
  cell: Cell;
  position: Point;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every scene cell whose centre is inside the room, in scene order. */
function cellsInRoom(placement: MapPlacement, room: Room): CellPick[] {
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
  const picks: CellPick[] = [];
  for (let row = min.row; row <= max.row; row++) {
    for (let col = min.col; col <= max.col; col++) {
      const cell = { col, row };
      const position = cellCenter(cell, placement.sceneDpi);
      if (roomContains(room, transform.sceneToImage(position))) {
        picks.push({ cell, position });
      }
    }
  }
  return picks;
}

/**
 * Picks up to `count` free cells inside the room, spread apart: the free cell
 * nearest the middle of the room first, then farthest-point sampling. Ties go
 * to the first cell in scene order (rows, then columns).
 */
export function pickFreeCells(input: {
  placement: MapPlacement;
  room: Room;
  occupied: readonly Cell[];
  count: number;
}): CellPick[] {
  if (input.count <= 0) return [];
  const inRoom = cellsInRoom(input.placement, input.room);
  const taken = new Set(input.occupied.map((c) => `${c.col},${c.row}`));
  const free = inRoom.filter((c) => !taken.has(`${c.cell.col},${c.cell.row}`));
  if (free.length === 0) return [];

  const mean: Point = {
    x: inRoom.reduce((sum, c) => sum + c.position.x, 0) / inRoom.length,
    y: inRoom.reduce((sum, c) => sum + c.position.y, 0) / inRoom.length,
  };
  let seed = free[0] as CellPick;
  for (const candidate of free) {
    if (distance(candidate.position, mean) < distance(seed.position, mean)) {
      seed = candidate;
    }
  }

  const picked: CellPick[] = [seed];
  const minDistance = free.map((c) => distance(c.position, seed.position));
  while (picked.length < Math.min(input.count, free.length)) {
    let best = -1;
    for (let i = 0; i < free.length; i++) {
      if (picked.includes(free[i] as CellPick)) continue;
      if (
        best === -1 ||
        (minDistance[i] as number) > (minDistance[best] as number)
      ) {
        best = i;
      }
    }
    const next = free[best] as CellPick;
    picked.push(next);
    free.forEach((c, i) => {
      minDistance[i] = Math.min(
        minDistance[i] as number,
        distance(c.position, next.position),
      );
    });
  }
  return picked;
}
