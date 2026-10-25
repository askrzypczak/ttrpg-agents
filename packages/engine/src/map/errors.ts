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

/**
 * The map to use cannot be picked: no map on the scene, several and no name,
 * a name two maps share, or no map with that name. The message lists the
 * maps' names, or says there are none.
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
