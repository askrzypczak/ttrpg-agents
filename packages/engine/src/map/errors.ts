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
