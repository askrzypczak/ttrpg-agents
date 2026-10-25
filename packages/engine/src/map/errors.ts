import { DomainError } from "../errors.js";

/** A cell label or cell range that cannot be parsed. */
export class InvalidCellRangeError extends DomainError {
  constructor(message: string) {
    super("invalid_cell_range", message);
    this.name = "InvalidCellRangeError";
  }
}

/** No room with that name; the message lists the known rooms, or says there are none. */
export class UnknownRoomError extends DomainError {
  constructor(message: string) {
    super("unknown_room", message);
    this.name = "UnknownRoomError";
  }
}

/** A room the index cannot store: a name given twice in one call, an empty or whitespace-only name, or no ranges. */
export class InvalidRoomError extends DomainError {
  constructor(message: string) {
    super("invalid_room", message);
    this.name = "InvalidRoomError";
  }
}

/**
 * The map to use cannot be picked: no map on the scene, several and no name,
 * a name two maps share, no map with that name, or the chosen map covers less
 * than one grid cell; or no map is in use, or the registered map is no
 * longer on the scene. The selection messages list the maps' names, or say
 * there are none.
 */
export class MapSelectionError extends DomainError {
  constructor(message: string) {
    super("map_selection", message);
    this.name = "MapSelectionError";
  }
}

/** The scene grid is not one the map geometry supports; the message names its type. */
export class UnsupportedGridError extends DomainError {
  constructor(message: string) {
    super("unsupported_grid", message);
    this.name = "UnsupportedGridError";
  }
}
