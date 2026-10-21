import { DomainError } from "../errors.js";

/** A damage or healing amount that is not a non-negative integer. */
export class InvalidAmountError extends DomainError {
  constructor(message: string) {
    super("invalid_amount", message);
    this.name = "InvalidAmountError";
  }
}

/** No instance with that id in the active encounter. */
export class UnknownInstanceError extends DomainError {
  constructor(message: string) {
    super("unknown_instance", message);
    this.name = "UnknownInstanceError";
  }
}
