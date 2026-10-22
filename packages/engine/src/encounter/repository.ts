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
  /** Deletes all instances of the active encounter. */
  clearEncounter(): void;
  /** Instances of the active encounter, ordered by creation. */
  listInstances(): MonsterInstance[];
}
