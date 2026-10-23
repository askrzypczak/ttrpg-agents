import type {
  Encounter,
  MonsterInstance,
  NewMonsterInstance,
} from "./types.js";

/** An instance as read inside one HP write: before and after the change. */
export interface HpChange {
  before: MonsterInstance;
  after: MonsterInstance;
}

/** Builds the items to insert from the display names already in the active encounter. */
export type InstanceBuilder = (existingNames: string[]) => NewMonsterInstance[];

export interface EncounterRepository {
  /** Returns the single active encounter, creating it if none exists. */
  getOrCreateActiveEncounter(): Encounter;
  /**
   * In one write transaction: reads the existing display names, calls `build`
   * with them and inserts the items it returns (all or nothing; rolls back if
   * `build` throws).
   */
  addInstances(build: InstanceBuilder): MonsterInstance[];
  /** Reduces HP, clamped at 0. Throws on unknown id or invalid amount. */
  applyDamage(id: string, amount: number): HpChange;
  /** Raises HP, clamped at maxHp. Throws on unknown id or invalid amount. */
  applyHealing(id: string, amount: number): HpChange;
  /**
   * Removes all given instances in one transaction and returns them. Throws
   * UnknownInstanceError, removing nothing, if any id is not in the active encounter.
   */
  removeInstances(ids: readonly string[]): MonsterInstance[];
  /**
   * Renames an instance of the active encounter in one transaction and returns
   * it updated; the name is trimmed. Throws UnknownInstanceError for an id not
   * in the active encounter, InvalidNameError for an empty name or one another
   * instance has; nothing changes on a throw.
   */
  renameInstance(id: string, name: string): MonsterInstance;
  /**
   * Sets the absolute initiative of an instance of the active encounter in one
   * transaction and returns it updated. Throws InvalidInitiativeError for a
   * non-integer value, UnknownInstanceError for an id not in the active
   * encounter; nothing changes on a throw.
   */
  setInitiative(id: string, initiative: number): MonsterInstance;
  /**
   * Sets the absolute current HP of an instance of the active encounter in one
   * transaction, clamped to 0..maxHp. Throws InvalidAmountError for a
   * non-integer value, UnknownInstanceError for an id not in the active
   * encounter; nothing changes on a throw.
   */
  setHp(id: string, hp: number): HpChange;
  /**
   * Sets the max HP of an instance of the active encounter in one transaction
   * (at least 1), lowering current HP if it is above the new max. Throws
   * InvalidAmountError for a non-integer value, UnknownInstanceError for an id
   * not in the active encounter; nothing changes on a throw.
   */
  setMaxHp(id: string, maxHp: number): HpChange;
  /**
   * Sets the armor class of an instance of the active encounter in one
   * transaction (at least 0) and returns it updated. Throws
   * InvalidArmorClassError for a non-integer value, UnknownInstanceError for
   * an id not in the active encounter; nothing changes on a throw.
   */
  setArmorClass(id: string, armorClass: number): MonsterInstance;
  /** Deletes all instances of the active encounter. */
  clearEncounter(): void;
  /** Instances of the active encounter, ordered by creation. */
  listInstances(): MonsterInstance[];
}
