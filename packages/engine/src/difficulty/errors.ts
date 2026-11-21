import { DomainError } from "../errors.js";

/** A hypothetical monster count that is not an integer of 1 or more. */
export class InvalidCountError extends DomainError {
  constructor(message: string) {
    super("invalid_count", message);
    this.name = "InvalidCountError";
  }
}
