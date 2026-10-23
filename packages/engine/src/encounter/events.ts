import { z } from "zod";
import type { EncounterRepository, HpChange } from "./repository.js";
import { monsterInstanceSchema } from "./types.js";

/** Source of truth for `EncounterEvent`; the protocol reuses it as the wire shape. */
export const encounterEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("added"),
    instances: z.array(monsterInstanceSchema),
  }),
  z.object({ type: z.literal("removed"), id: z.string() }),
  z.object({ type: z.literal("cleared") }),
  z.object({
    type: z.literal("hp-changed"),
    id: z.string(),
    currentHp: z.number(),
    maxHp: z.number(),
  }),
]);

export type EncounterEvent = z.infer<typeof encounterEventSchema>;

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
 * Wraps a repository so every successful mutation emits an event afterwards,
 * except renameInstance and setInitiative (the bridge syncs those by
 * snapshot). Failed calls (throws) emit nothing.
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
    // Snapshot-only: a rename emits no event.
    renameInstance: (id, name) => repo.renameInstance(id, name),
    // Snapshot-only: setting initiative emits no event.
    setInitiative: (id, initiative) => repo.setInitiative(id, initiative),
    setHp() {
      throw new Error("not implemented");
    },
    setMaxHp() {
      throw new Error("not implemented");
    },
    setArmorClass() {
      throw new Error("not implemented");
    },
    clearEncounter() {
      repo.clearEncounter();
      emitter.emit({ type: "cleared" });
    },
  };
}
