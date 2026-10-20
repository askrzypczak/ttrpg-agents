import type { EncounterRepository, HpChange } from "./repository.js";
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

function emitHp(emitter: EncounterEmitter, { after }: HpChange): void {
  emitter.emit({
    type: "hp-changed",
    id: after.id,
    currentHp: after.currentHp,
    maxHp: after.maxHp,
  });
}

/**
 * Wraps a repository so every successful mutation emits an event afterwards.
 * Failed calls (throws) emit nothing.
 */
export function observeRepository(
  repo: EncounterRepository,
  emitter: EncounterEmitter,
): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => repo.getOrCreateActiveEncounter(),
    listInstances: () => repo.listInstances(),
    addInstances(build) {
      const instances = repo.addInstances(build);
      if (instances.length > 0) emitter.emit({ type: "added", instances });
      return instances;
    },
    applyDamage(id, amount) {
      const change = repo.applyDamage(id, amount);
      emitHp(emitter, change);
      return change;
    },
    applyHealing(id, amount) {
      const change = repo.applyHealing(id, amount);
      emitHp(emitter, change);
      return change;
    },
    removeInstances(ids) {
      const removed = repo.removeInstances(ids);
      for (const instance of removed) {
        emitter.emit({ type: "removed", id: instance.id });
      }
      return removed;
    },
    clearEncounter() {
      repo.clearEncounter();
      emitter.emit({ type: "cleared" });
    },
  };
}
