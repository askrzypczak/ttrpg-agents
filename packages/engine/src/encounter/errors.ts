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

/** No instance with that id in the encounter. */
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

/** A display name or an encounter name that is empty or already taken. */
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

/** No encounter with that name; the message lists the encounters' names, or says there are none. */
export class UnknownEncounterError extends DomainError {
  constructor(message: string) {
    super("unknown_encounter", message);
    this.name = "UnknownEncounterError";
  }
}

/** A read in an open scene that no encounter is bound to. */
export class NoSceneEncounterError extends DomainError {
  constructor(message: string) {
    super("no_scene_encounter", message);
    this.name = "NoSceneEncounterError";
  }
}

/** A binding use_encounter refuses: no scene is open, the open scene has an encounter, or the encounter belongs to another scene. */
export class SceneBindingError extends DomainError {
  constructor(message: string) {
    super("scene_binding", message);
    this.name = "SceneBindingError";
  }
}

/** A target that already is the requested monster. */
export class SameMonsterError extends DomainError {
  constructor(message: string) {
    super("same_monster", message);
    this.name = "SameMonsterError";
  }
}
