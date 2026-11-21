import { DomainError } from "../errors.js";

/** A party size or level that is neither given nor stored, or out of range: a size that is not a whole number of 1 or more, a level that is not a whole number from 1 to 20. The message names each failing number. */
export class InvalidPartyError extends DomainError {
  constructor(message: string) {
    super("invalid_party", message);
    this.name = "InvalidPartyError";
  }
}
