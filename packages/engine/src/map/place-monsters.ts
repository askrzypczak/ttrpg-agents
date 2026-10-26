import {
  addMonsters,
  MAX_GROUP_COUNT,
  type AddMonstersDeps,
  type AddMonstersGroup,
  type AddMonstersOptions,
  type AddMonstersResult,
} from "../encounter/add-monsters.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import { validateAddMonsters } from "../encounter/validate-add-monsters.js";
import type { TablePort } from "../table/port.js";
import { sceneToCell } from "./cells.js";
import { displayGrid, formatCellLabel } from "./display-grid.js";
import { liveActiveMap, requireActiveMap } from "./live-map.js";
import { pickFreeCells, type CellPick } from "./picker.js";
import type { MapRepository } from "./repository.js";
import { findRoom, type Room } from "./rooms.js";

/** A group of monsters to add, optionally placed in a saved room of the map in use. */
export interface RoomGroup extends AddMonstersGroup {
  /** Saved room name, matched ignoring case. */
  room?: string;
}

/** Where one monster of a group with a room was placed; `cell` is null when no free cell was left. */
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
 * Adds the groups like `addMonsters`; each group with a room gets free cells
 * inside that room of the map in use as spawn positions. A cell is occupied
 * when it holds the centre of a token on the table or was picked for an
 * earlier group; monsters left without a free cell get no spawn position.
 * Without any room the table is not asked. Every check runs before the store
 * write.
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
  const occupied = tokens.tokens.map((t) =>
    sceneToCell(t.position, live.placement.sceneDpi),
  );
  const picks: (CellPick[] | undefined)[] = groups.map((g, i) => {
    const room = rooms[i];
    if (room === undefined) return undefined;
    const picked = pickFreeCells({
      placement: live.placement,
      room,
      occupied,
      count: g.count,
    });
    occupied.push(...picked.map((p) => p.cell));
    return picked;
  });

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
        cell:
          pick === undefined
            ? null
            : formatCellLabel(grid.sceneCellToDisplay(pick.cell)),
      });
    }
  });
  return { ...result, placements, moved: live.moved };
}

/** The group as `addMonsters` takes it, so the room does not leak into the store. */
function withoutRoom(group: RoomGroup): AddMonstersGroup {
  const { room, ...rest } = group;
  void room;
  return rest;
}
