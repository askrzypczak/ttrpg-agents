import type {
  AddMonstersDeps,
  AddMonstersGroup,
  AddMonstersOptions,
  AddMonstersResult,
} from "../encounter/add-monsters.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { TablePort } from "../table/port.js";
import type { MapRepository } from "./repository.js";

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
 * inside that room of the map in use as spawn positions.
 */
export async function addMonstersInRooms(
  deps: AddMonstersDeps & {
    table: Pick<TablePort, "sceneMap" | "sceneTokens">;
    maps: Pick<MapRepository, "getActiveMap" | "getRooms">;
  },
  groups: readonly RoomGroup[],
  origin: ChangeOrigin,
  options?: AddMonstersOptions,
): Promise<AddMonstersInRoomsResult> {
  void deps;
  void groups;
  void origin;
  void options;
  await Promise.resolve();
  throw new Error("not implemented");
}
