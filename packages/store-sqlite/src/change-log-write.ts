import type { DatabaseSync } from "node:sqlite";
import type { EncounterEvent } from "@ttrpg-agents/engine";

/** Appends an event to the change log under `encounterId` (null: no encounter), logging the origin without its command name; returns its seq. Call it inside a write transaction. */
export function appendEvent(
  db: DatabaseSync,
  event: EncounterEvent,
  encounterId: string | null,
): number {
  void db;
  void event;
  void encounterId;
  throw new Error("not implemented");
}

/** Runs `fn` in a BEGIN IMMEDIATE transaction, joining one already open; a throw rolls back and is rethrown. */
export function writeTransaction<T>(db: DatabaseSync, fn: () => T): T {
  void db;
  void fn;
  throw new Error("not implemented");
}
