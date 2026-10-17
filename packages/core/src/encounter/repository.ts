import type {
  Encounter,
  MonsterInstance,
  NewMonsterInstance,
} from "./types.js";

export interface EncounterRepository {
  /** Returns the single active encounter, creating it if none exists. */
  getOrCreateActiveEncounter(): Encounter;
  /** Adds all items to the active encounter in one transaction (all or nothing). */
  addInstances(items: NewMonsterInstance[]): MonsterInstance[];
  /** Reduces HP, clamped at 0. Throws on unknown id or invalid amount. */
  applyDamage(id: string, amount: number): MonsterInstance;
  /** Raises HP, clamped at maxHp. Throws on unknown id or invalid amount. */
  applyHealing(id: string, amount: number): MonsterInstance;
  /** Returns true if an instance was removed. */
  removeInstance(id: string): boolean;
  /** Deletes all instances of the active encounter. */
  clearEncounter(): void;
  /** Instances of the active encounter, ordered by creation. */
  listInstances(): MonsterInstance[];
}
