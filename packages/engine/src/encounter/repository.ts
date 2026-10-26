import type { Point } from "../map/types.js";
import type { ChangeOrigin } from "./origin.js";
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

/** A removed instance kept for restoring, with the change that removed it. */
export interface RemovedInstance {
  instance: MonsterInstance;
  /** Who removed it, in which command. */
  removedBy: ChangeOrigin;
}

/** Picks a restored instance's display name from the names in use. */
export type RestoreNamer = (
  instance: MonsterInstance,
  namesInUse: readonly string[],
) => string;

export interface EncounterRepository {
  /** Returns the single active encounter, creating it if none exists. */
  getOrCreateActiveEncounter(): Encounter;
  /**
   * In one write transaction: reads the existing display names, calls `build`
   * with them and inserts the items it returns (all or nothing; rolls back if
   * `build` throws).
   */
  addInstances(build: InstanceBuilder, origin: ChangeOrigin): MonsterInstance[];
  /** Reduces HP, clamped at 0. Throws on unknown id or invalid amount. */
  applyDamage(id: string, amount: number, origin: ChangeOrigin): HpChange;
  /** Raises HP, clamped at maxHp. Throws on unknown id or invalid amount. */
  applyHealing(id: string, amount: number, origin: ChangeOrigin): HpChange;
  /**
   * Removes all given instances in one transaction and returns them. Throws
   * UnknownInstanceError, removing nothing, if any id is not in the active encounter.
   */
  removeInstances(
    ids: readonly string[],
    origin: ChangeOrigin,
  ): MonsterInstance[];
  /** Removed instances of the active encounter not restored since, newest removal first; kept until the encounter is cleared. */
  listRemovedInstances(): RemovedInstance[];
  /**
   * In one transaction puts removed instances of the active encounter back with the state they had when removed,
   * each named by `name` from the names in use (the encounter's plus those restored before it in this call),
   * records one `added` event for them and returns them in the order given. Throws UnknownInstanceError for an id
   * that is not a removed instance of the active encounter, InvalidNameError for a picked name that is empty or in
   * use; nothing changes on a throw.
   */
  restoreInstances(
    ids: readonly string[],
    name: RestoreNamer,
    origin: ChangeOrigin,
  ): MonsterInstance[];
  /**
   * Renames an instance of the active encounter in one transaction and returns
   * it updated; the name is trimmed. Throws UnknownInstanceError for an id not
   * in the active encounter, InvalidNameError for an empty name or one another
   * instance has; nothing changes on a throw.
   */
  renameInstance(
    id: string,
    name: string,
    origin: ChangeOrigin,
  ): MonsterInstance;
  /**
   * Sets the absolute initiative of an instance of the active encounter in one
   * transaction and returns it updated; `null` clears it. Throws
   * InvalidInitiativeError for a non-integer number, UnknownInstanceError for an id not in the active
   * encounter; nothing changes on a throw.
   */
  setInitiative(
    id: string,
    initiative: number | null,
    origin: ChangeOrigin,
  ): MonsterInstance;
  /**
   * Sets the absolute current HP of an instance of the active encounter in one
   * transaction, clamped to 0..maxHp. Throws InvalidAmountError for a
   * non-integer value, UnknownInstanceError for an id not in the active
   * encounter; nothing changes on a throw.
   */
  setHp(id: string, hp: number, origin: ChangeOrigin): HpChange;
  /**
   * Sets the max HP of an instance of the active encounter in one transaction
   * (at least 1), lowering current HP if it is above the new max. Throws
   * InvalidAmountError for a non-integer value, UnknownInstanceError for an id
   * not in the active encounter; nothing changes on a throw.
   */
  setMaxHp(id: string, maxHp: number, origin: ChangeOrigin): HpChange;
  /**
   * Sets the armor class of an instance of the active encounter in one
   * transaction (at least 0) and returns it updated. Throws
   * InvalidArmorClassError for a non-integer value, UnknownInstanceError for
   * an id not in the active encounter; nothing changes on a throw.
   */
  setArmorClass(
    id: string,
    armorClass: number,
    origin: ChangeOrigin,
  ): MonsterInstance;
  /**
   * Sets whether players see the stats of an instance of the active encounter
   * and returns it updated. Throws UnknownInstanceError for an id not in the
   * active encounter; nothing changes on a throw.
   */
  setStatsVisible(
    id: string,
    visible: boolean,
    origin: ChangeOrigin,
  ): MonsterInstance;
  /**
   * Sets the spawn position of each given instance of the active encounter in
   * one transaction, appending one `position-changed` event per entry, and
   * returns the instances updated, in input order. The only way an existing
   * instance's spawn position changes (the move tool). Throws
   * UnknownInstanceError, changing nothing, if any id is not in the active
   * encounter.
   */
  setSpawnPositions(
    positions: readonly { id: string; spawnPosition: Point }[],
    origin: ChangeOrigin,
  ): MonsterInstance[];
  /** Deletes all instances of the active encounter. */
  clearEncounter(origin: ChangeOrigin): void;
  /** Instances of the active encounter, ordered by creation. */
  listInstances(): MonsterInstance[];
}
