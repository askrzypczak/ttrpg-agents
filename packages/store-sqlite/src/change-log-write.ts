import type { DatabaseSync } from "node:sqlite";
import type { EncounterEvent } from "@ttrpg-agents/engine";

/** Appends an event to the change log under `encounterId` (null: no encounter), logging the origin without its command name; returns its seq. Call it inside a write transaction. */
export function appendEvent(
  db: DatabaseSync,
  event: EncounterEvent,
  encounterId: string | null,
): number {
  const { source, commandId } = event.origin;
  const logged = { ...event, origin: { source, commandId } };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO encounter_events (event, encounter_id) VALUES (?, ?)")
    .run(JSON.stringify(logged), encounterId);
  return Number(lastInsertRowid);
}

/** Runs `fn` in a BEGIN IMMEDIATE transaction, joining one already open; a throw rolls back and is rethrown. */
export function writeTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
