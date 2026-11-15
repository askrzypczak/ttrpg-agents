import { DomainError } from "../errors.js";

/** A creature statblock that fails monsterSchema; the message names every failing field by path. */
export class InvalidCreatureError extends DomainError {
  constructor(message: string) {
    super("invalid_creature", message);
    this.name = "InvalidCreatureError";
  }
}

/** A section change whose entry name matches no entry of its section, or several. */
export class CreatureEntryError extends DomainError {
  constructor(message: string) {
    super("unknown_entry", message);
    this.name = "CreatureEntryError";
  }
}

/** A book tag outside monsterSchema's pattern, or one reserved for built-in data. */
export class BookTagError extends DomainError {
  constructor(message: string) {
    super("invalid_book_tag", message);
    this.name = "BookTagError";
  }
}

/** A creature name (or its key) that a stored creature of the book already has. */
export class CreatureNameTakenError extends DomainError {
  constructor(message: string) {
    super("creature_name_taken", message);
    this.name = "CreatureNameTakenError";
  }
}
