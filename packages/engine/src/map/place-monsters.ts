import {
  addMonsters,
  MAX_GROUP_COUNT,
  type AddMonstersDeps,
  type AddMonstersGroup,
  type AddMonstersOptions,
  type AddMonstersResult,
} from "../encounter/add-monsters.js";
import { UnknownInstanceError } from "../encounter/errors.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { EncounterRepository } from "../encounter/repository.js";
import { validateAddMonsters } from "../encounter/validate-add-monsters.js";
import { footprintForSize } from "../monsters/footprint.js";
import type { TablePort, TableToken } from "../table/port.js";
import {
  displayGrid,
  formatCellRange,
  type DisplayGrid,
} from "./display-grid.js";
import { liveActiveMap, requireActiveMap } from "./live-map.js";
import { pickFreeCells, type CellPick } from "./picker.js";
import type { MapRepository } from "./repository.js";
import { findRoom, type Room } from "./rooms.js";
import type { Cell } from "./types.js";

/** A group of monsters to add, optionally placed in a saved room of the map in use. */
export interface RoomGroup extends AddMonstersGroup {
  /** Saved room name, matched ignoring case. */
  room?: string;
}

/**
 * Where one monster of a group with a room was placed: `cell` is its display
 * cell label, or its block's display range ("A1:B2") for a footprint above 1;
 * null when no free block was left.
 */
export interface RoomPlacement {
  id: string;
  name: string;
  room: string;
  cell: string | null;
}

export interface AddMonstersInRoomsResult extends AddMonstersResult {
  placements: RoomPlacement[];
  moved: boolean;
}

/**
 * Adds the groups like `addMonsters`; each group with a room gets free blocks
 * of its footprint inside that room of the map in use as spawn positions,
 * larger monsters first. A cell is occupied when its centre lies inside or on
 * the edge of a token's bounds on the table or it was picked for another
 * group; monsters left without a free block get no spawn position. Without any
 * room the table is not asked. Every check runs before the store write.
 */
export async function addMonstersInRooms(
  deps: AddMonstersDeps & {
    table: Pick<TablePort, "sceneMap" | "sceneTokens">;
    maps: Pick<MapRepository, "getActiveMap" | "getRooms">;
  },
  groups: readonly RoomGroup[],
  origin: ChangeOrigin,
  options: AddMonstersOptions = {},
): Promise<AddMonstersInRoomsResult> {
  if (groups.every((g) => g.room === undefined)) {
    return {
      ...addMonsters(deps, groups.map(withoutRoom), origin, options),
      placements: [],
      moved: false,
    };
  }
  validateAddMonsters(
    deps.monsters,
    groups,
    options.maxGroupCount ?? MAX_GROUP_COUNT,
    options.initiative ?? "group",
  );
  const active = requireActiveMap(deps.maps);
  const saved = deps.maps.getRooms(active.itemId);
  const rooms: (Room | undefined)[] = groups.map((g) =>
    g.room === undefined ? undefined : findRoom(saved, g.room),
  );

  const [live, tokens] = await Promise.all([
    liveActiveMap(deps.table, deps.maps),
    deps.table.sceneTokens(),
  ]);
  const dpi = live.placement.sceneDpi;
  const occupied = tokens.tokens.flatMap((t) => cellsUnderBounds(t, dpi));
  const footprints = groups.map((g) => {
    const monster = deps.monsters.byKey.get(g.monster);
    return monster === undefined ? 1 : footprintForSize(monster.size);
  });
  const order = groups
    .map((_, i) => i)
    .sort((a, b) => (footprints[b] as number) - (footprints[a] as number));
  const picks: (CellPick[] | undefined)[] = groups.map(() => undefined);
  for (const i of order) {
    const room = rooms[i];
    const group = groups[i];
    if (room === undefined || group === undefined) continue;
    const picked = pickFreeCells({
      placement: live.placement,
      room,
      occupied,
      count: group.count,
      footprint: footprints[i] as number,
    });
    for (const p of picked) occupied.push(...p.cells);
    picks[i] = picked;
  }

  const result = addMonsters(
    deps,
    groups.map((g, i) => {
      const plain = withoutRoom(g);
      const groupPicks = picks[i];
      return groupPicks === undefined
        ? plain
        : { ...plain, spawnPositions: groupPicks.map((p) => p.position) };
    }),
    origin,
    options,
  );

  const grid = displayGrid(live.placement);
  const placements: RoomPlacement[] = [];
  let next = 0;
  groups.forEach((g, i) => {
    const room = rooms[i];
    const groupPicks = picks[i] ?? [];
    for (let n = 0; n < g.count; n++) {
      const instance = result.instances[next++];
      if (room === undefined || instance === undefined) continue;
      const pick = groupPicks[n];
      placements.push({
        id: instance.id,
        name: instance.name,
        room: room.name,
        cell: pick === undefined ? null : blockRange(grid, pick),
      });
    }
  });
  return { ...result, placements, moved: live.moved };
}

/** Where each named monster was moved, in input order, and whether the map moved on the table. */
export interface MoveIntoRoomResult {
  placements: RoomPlacement[];
  moved: boolean;
}

/**
 * Moves existing instances of the active encounter into a saved room of the
 * map in use, with the same placement as `addMonstersInRooms` (free blocks of
 * each footprint, cells under the table's tokens occupied, largest footprint
 * first, ties in input order). Checks every id (UnknownInstanceError), then
 * the map in use and the room, before asking the table; stores the placed
 * monsters' new spawn positions in at most one `setSpawnPositions` call (none
 * when nothing fits). Placements are in input order; `cell` is null for a
 * monster left without a free block, which keeps its spawn position.
 */
export async function moveMonstersIntoRoom(
  deps: {
    repo: Pick<EncounterRepository, "listInstances" | "setSpawnPositions">;
    table: Pick<TablePort, "sceneMap" | "sceneTokens">;
    maps: Pick<MapRepository, "getActiveMap" | "getRooms">;
  },
  ids: readonly string[],
  room: string,
  origin: ChangeOrigin,
): Promise<MoveIntoRoomResult> {
  const stored = deps.repo.listInstances();
  const instances = ids.map((id) => {
    const instance = stored.find((i) => i.id === id);
    if (instance === undefined)
      throw new UnknownInstanceError(`Unknown monster instance: ${id}`);
    return instance;
  });
  const active = requireActiveMap(deps.maps);
  const target = findRoom(deps.maps.getRooms(active.itemId), room);

  const [live, tokens] = await Promise.all([
    liveActiveMap(deps.table, deps.maps),
    deps.table.sceneTokens(),
  ]);
  const dpi = live.placement.sceneDpi;
  const occupied = tokens.tokens.flatMap((t) => cellsUnderBounds(t, dpi));

  const classes = new Map<number, number[]>();
  instances.forEach((instance, n) => {
    const members = classes.get(instance.footprint);
    if (members === undefined) classes.set(instance.footprint, [n]);
    else members.push(n);
  });
  const picks: (CellPick | undefined)[] = instances.map(() => undefined);
  for (const footprint of [...classes.keys()].sort((a, b) => b - a)) {
    const members = classes.get(footprint) as number[];
    const picked = pickFreeCells({
      placement: live.placement,
      room: target,
      occupied,
      count: members.length,
      footprint,
    });
    picked.forEach((pick, k) => {
      picks[members[k] as number] = pick;
      occupied.push(...pick.cells);
    });
  }

  const positions = instances.flatMap((instance, n) => {
    const pick = picks[n];
    return pick === undefined
      ? []
      : [{ id: instance.id, spawnPosition: pick.position }];
  });
  if (positions.length > 0) deps.repo.setSpawnPositions(positions, origin);

  const grid = displayGrid(live.placement);
  const placements = instances.map((instance, n): RoomPlacement => {
    const pick = picks[n];
    return {
      id: instance.id,
      name: instance.displayName,
      room: target.name,
      cell: pick === undefined ? null : blockRange(grid, pick),
    };
  });
  return { placements, moved: live.moved };
}

/** The display label of a block: "A1" for one cell, "A1:B2" for more. */
function blockRange(grid: DisplayGrid, pick: CellPick): string {
  const first = pick.cells[0] as Cell;
  const last = pick.cells[pick.cells.length - 1] as Cell;
  return formatCellRange({
    from: grid.sceneCellToDisplay(first),
    to: grid.sceneCellToDisplay(last),
  });
}

/**
 * The scene cells whose centre lies inside or on the edge of the token's
 * bounds, with a small tolerance for float noise.
 */
function cellsUnderBounds(token: TableToken, dpi: number): Cell[] {
  const { min, max } = token.bounds;
  const eps = 1e-9;
  const fromCol = Math.ceil(min.x / dpi - 0.5 - eps);
  const toCol = Math.floor(max.x / dpi - 0.5 + eps);
  const fromRow = Math.ceil(min.y / dpi - 0.5 - eps);
  const toRow = Math.floor(max.y / dpi - 0.5 + eps);
  const cells: Cell[] = [];
  for (let row = fromRow; row <= toRow; row++) {
    for (let col = fromCol; col <= toCol; col++) cells.push({ col, row });
  }
  return cells;
}

/** The group as `addMonsters` takes it, so the room does not leak into the store. */
function withoutRoom(group: RoomGroup): AddMonstersGroup {
  const { room, ...rest } = group;
  void room;
  return rest;
}
