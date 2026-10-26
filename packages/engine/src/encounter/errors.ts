import { DomainError } from "../errors.js";

/**
 * A damage or healing amount that is not a non-negative integer, or an
 * absolute HP or max HP value that is not an integer.
 */
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

/** No monster with that key in the monster index. */
export class UnknownMonsterError extends DomainError {
  constructor(message: string) {
    super("unknown_monster", message);
    this.name = "UnknownMonsterError";
  }
}

/** A display name that is empty or already used by another instance. */
export class InvalidNameError extends DomainError {
  constructor(message: string) {
    super("invalid_name", message);
    this.name = "InvalidNameError";
  }
}

/** An initiative value that is not an integer. */
export class InvalidInitiativeError extends DomainError {
  constructor(message: string) {
    super("invalid_initiative", message);
    this.name = "InvalidInitiativeError";
  }
}

/** An armor class value that is not an integer. */
export class InvalidArmorClassError extends DomainError {
  constructor(message: string) {
    super("invalid_armor_class", message);
    this.name = "InvalidArmorClassError";
  }
}

/** A target that already is the requested monster. */
export class SameMonsterError extends DomainError {
  constructor(message: string) {
    super("same_monster", message);
    this.name = "SameMonsterError";
  }
}
