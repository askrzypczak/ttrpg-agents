import type { DatabaseSync } from "node:sqlite";
import type { EncounterEvents, EncounterRepository } from "@ttrpg-agents/core";
import type { BridgeMessage } from "@ttrpg-agents/core/bridge";

/** Full current instance list, for a client that just connected. */
export function snapshotMessage(repo: EncounterRepository): BridgeMessage {
  return {
    v: 1,
    type: "encounter-snapshot",
    payload: { instances: repo.listInstances() },
  };
}

/** Forwards every encounter event to bridge clients. Returns an unsubscribe. */
export function forwardEncounterEvents(
  events: EncounterEvents,
  target: { broadcast(message: BridgeMessage): void },
): () => void {
  return events.subscribe((event) =>
    target.broadcast({ v: 1, type: "encounter-event", payload: event }),
  );
}

/** SQLite `PRAGMA data_version`: changes when another connection commits. */
export function dataVersion(db: DatabaseSync): number {
  void db;
  throw new Error("not implemented");
}

/**
 * Polls `readVersion` and broadcasts `snapshotMessage(repo)` whenever it
 * changes. Returns a stop function.
 */
export function broadcastSnapshotsOnChange(
  readVersion: () => number,
  repo: EncounterRepository,
  target: { broadcast(message: BridgeMessage): void },
  options?: { intervalMs?: number },
): () => void {
  void readVersion;
  void repo;
  void target;
  void options;
  throw new Error("not implemented");
}
