import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export type EncounterEvent =
  | { type: "added"; instances: MonsterInstance[] }
  | { type: "removed"; id: string }
  | { type: "cleared" }
  | { type: "hp-changed"; id: string; currentHp: number; maxHp: number };

export type EncounterListener = (event: EncounterEvent) => void;

export interface EncounterEvents {
  /** Returns an unsubscribe function. */
  subscribe(listener: EncounterListener): () => void;
}

export interface EncounterEmitter extends EncounterEvents {
  emit(event: EncounterEvent): void;
}

/** Listeners run synchronously in subscription order; a throwing listener does not affect the others. */
export function createEncounterEmitter(): EncounterEmitter {
  const listeners = new Set<EncounterListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A broken subscriber must not break the mutation that triggered it.
        }
      }
    },
  };
}

/**
 * Wraps a repository so every successful mutation emits an event afterwards.
 * Failed calls (throws) and no-ops (removeInstance returning false) emit nothing.
 */
export function observeRepository(
  repo: EncounterRepository,
  emitter: EncounterEmitter,
): EncounterRepository {
  const hpChanged = (instance: MonsterInstance): MonsterInstance => {
    emitter.emit({
      type: "hp-changed",
      id: instance.id,
      currentHp: instance.currentHp,
      maxHp: instance.maxHp,
    });
    return instance;
  };
  return {
    getOrCreateActiveEncounter: () => repo.getOrCreateActiveEncounter(),
    listInstances: () => repo.listInstances(),
    addInstances(items) {
      const instances = repo.addInstances(items);
      if (instances.length > 0) emitter.emit({ type: "added", instances });
      return instances;
    },
    applyDamage: (id, amount) => hpChanged(repo.applyDamage(id, amount)),
    applyHealing: (id, amount) => hpChanged(repo.applyHealing(id, amount)),
    removeInstance(id) {
      const removed = repo.removeInstance(id);
      if (removed) emitter.emit({ type: "removed", id });
      return removed;
    },
    clearEncounter() {
      repo.clearEncounter();
      emitter.emit({ type: "cleared" });
    },
  };
}
