import { z } from "zod";
import type { EncounterRepository, HpChange } from "./repository.js";
import { changeOriginSchema, type ChangeOrigin } from "./origin.js";
import { monsterInstanceSchema } from "./types.js";

/** Source of truth for `EncounterEvent`; the protocol reuses it as the wire shape. */
export const encounterEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("added"),
    instances: z.array(monsterInstanceSchema),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("removed"),
    id: z.string(),
    origin: changeOriginSchema,
  }),
  z.object({ type: z.literal("cleared"), origin: changeOriginSchema }),
  z.object({
    type: z.literal("hp-changed"),
    id: z.string(),
    currentHp: z.number(),
    maxHp: z.number(),
    origin: changeOriginSchema,
  }),
  z.object({
    type: z.literal("instance-changed"),
    id: z.string(),
    changes: z
      .object({
        name: z.string(),
        initiative: z.number(),
        armorClass: z.number(),
        statsVisible: z.boolean(),
      })
      .partial()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: "changes must name at least one field",
      }),
    origin: changeOriginSchema,
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

function emitHp(
  emitter: EncounterEmitter,
  { after }: HpChange,
  origin: ChangeOrigin,
): void {
  emitter.emit({
    type: "hp-changed",
    id: after.id,
    currentHp: after.currentHp,
    maxHp: after.maxHp,
    origin,
  });
}

/**
 * Wraps a repository so every successful mutation emits an event afterwards,
 * except renameInstance, setInitiative, setArmorClass and setStatsVisible (the bridge syncs
 * those by snapshot). Failed calls (throws) emit nothing.
 */
export function observeRepository(
  repo: EncounterRepository,
  emitter: EncounterEmitter,
): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => repo.getOrCreateActiveEncounter(),
    listInstances: () => repo.listInstances(),
    addInstances(build, origin) {
      const instances = repo.addInstances(build, origin);
      if (instances.length > 0)
        emitter.emit({ type: "added", instances, origin });
      return instances;
    },
    applyDamage(id, amount, origin) {
      const change = repo.applyDamage(id, amount, origin);
      emitHp(emitter, change, origin);
      return change;
    },
    applyHealing(id, amount, origin) {
      const change = repo.applyHealing(id, amount, origin);
      emitHp(emitter, change, origin);
      return change;
    },
    removeInstances(ids, origin) {
      const removed = repo.removeInstances(ids, origin);
      for (const instance of removed) {
        emitter.emit({ type: "removed", id: instance.id, origin });
      }
      return removed;
    },
    renameInstance: (id, name, origin) => repo.renameInstance(id, name, origin),
    setInitiative: (id, initiative, origin) =>
      repo.setInitiative(id, initiative, origin),
    setHp(id, hp, origin) {
      const change = repo.setHp(id, hp, origin);
      emitHp(emitter, change, origin);
      return change;
    },
    setMaxHp(id, maxHp, origin) {
      const change = repo.setMaxHp(id, maxHp, origin);
      emitHp(emitter, change, origin);
      return change;
    },
    setArmorClass: (id, armorClass, origin) =>
      repo.setArmorClass(id, armorClass, origin),
    setStatsVisible: (id, visible, origin) =>
      repo.setStatsVisible(id, visible, origin),
    clearEncounter(origin) {
      repo.clearEncounter(origin);
      emitter.emit({ type: "cleared", origin });
    },
  };
}
