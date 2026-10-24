import type { InstanceEdit } from "@ttrpg-agents/engine";
import type { Timers } from "./reconnecting-socket.js";
import type { EncounterInstance } from "./sync-plan.js";

/** How long a table edit must stay unchanged before it is written back. */
export const EDIT_SETTLE_MS = 500;

/**
 * Holds table edits until they settle, and the sent ones until the store
 * answers, so the sync plans against an encounter that matches the table.
 */
export interface EditSettler {
  /** The instances with each one's sent, then settling, edit applied. */
  overlay(desired: EncounterInstance[]): EncounterInstance[];
  /** Merges the planner's edits (relative to the overlay) into the settling ones. */
  observe(edits: InstanceEdit[], desired: EncounterInstance[]): void;
  /** The store answered: forget the sent edit of one instance, or of all. */
  answered(instanceId?: string): void;
}

type Patch = Omit<InstanceEdit, "instanceId">;

interface Entry {
  /** Edits not sent yet, and the timer that sends them. */
  draft: Patch;
  timer: unknown;
  /** Edits sent, awaiting the store's answer. */
  sent: Patch;
}

const isEmpty = (patch: Patch): boolean => Object.keys(patch).length === 0;

export function createEditSettler(options: {
  timers: Timers;
  settleMs: number;
  send: (edit: InstanceEdit) => void;
}): EditSettler {
  const { timers } = options;
  const entries = new Map<string, Entry>();

  const cancel = (entry: Entry): void => {
    timers.clearTimeout(entry.timer);
    entry.timer = undefined;
  };

  const fire = (id: string, entry: Entry): void => {
    entry.timer = undefined;
    const draft = entry.draft;
    entry.draft = {};
    entry.sent = { ...entry.sent, ...draft };
    options.send({ instanceId: id, ...draft });
  };

  return {
    overlay(desired) {
      const ids = new Set(desired.map((i) => i.id));
      for (const [id, entry] of entries) {
        if (ids.has(id)) continue;
        cancel(entry);
        entries.delete(id);
      }
      return desired.map((instance) => {
        const entry = entries.get(instance.id);
        return entry
          ? { ...instance, ...entry.sent, ...entry.draft }
          : instance;
      });
    },
    observe(edits, desired) {
      const byId = new Map<string, Patch>();
      for (const { instanceId, ...patch } of edits)
        byId.set(instanceId, { ...byId.get(instanceId), ...patch });
      for (const [id, patch] of byId) {
        const instance = desired.find((i) => i.id === id);
        if (instance === undefined) continue;
        const entry = entries.get(id) ?? {
          draft: {},
          timer: undefined,
          sent: {},
        };
        const stored: Record<string, unknown> = { ...instance, ...entry.sent };
        const draft: Record<string, unknown> = entry.draft;
        let changed = false;
        for (const [field, value] of Object.entries(patch)) {
          // A value the store already has is no edit.
          const next = value === stored[field] ? undefined : value;
          if (draft[field] === next) continue;
          if (next === undefined) delete draft[field];
          else draft[field] = next;
          changed = true;
        }
        entries.set(id, entry);
        if (isEmpty(entry.draft)) cancel(entry);
        else if (changed) {
          cancel(entry);
          entry.timer = timers.setTimeout(
            () => fire(id, entry),
            options.settleMs,
          );
        }
      }
    },
    answered(instanceId) {
      for (const [id, entry] of entries) {
        if (instanceId !== undefined && id !== instanceId) continue;
        entry.sent = {};
      }
    },
  };
}
