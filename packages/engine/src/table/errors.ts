import { DomainError } from "../errors.js";

/** The table could not be asked: not connected, timed out, bridge unreachable, bad reply. */
export class TableUnavailableError extends DomainError {
  constructor(message: string) {
    super("table_unavailable", message);
    this.name = "TableUnavailableError";
  }
}
