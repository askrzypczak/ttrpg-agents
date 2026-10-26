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
import { liveActiveMap, requireActiveMap } from "./live-map.js";
import type { MapRepository } from "./repository.js";
import { findRoom, type Room } from "./rooms.js";

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
  void rooms;
  void live;
  void tokens;
  throw new Error("not implemented");
}

/** The group as `addMonsters` takes it, so the room does not leak into the store. */
function withoutRoom(group: RoomGroup): AddMonstersGroup {
  const { room, ...rest } = group;
  void room;
  return rest;
}
