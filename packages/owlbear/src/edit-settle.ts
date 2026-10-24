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

export function createEditSettler(options: {
  timers: Timers;
  settleMs: number;
  send: (edit: InstanceEdit) => void;
}): EditSettler {
  void options;
  throw new Error("not implemented");
}
