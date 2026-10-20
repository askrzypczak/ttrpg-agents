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

const SNAPSHOT_POLL_INTERVAL_MS = 250;

/** SQLite `PRAGMA data_version`: changes when another connection commits. */
export function dataVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA data_version").get() as
    { data_version?: unknown } | undefined;
  const version = row?.data_version;
  if (typeof version !== "number") {
    throw new Error("PRAGMA data_version did not return a number");
  }
  return version;
}

/**
 * Polls `readVersion` and broadcasts `snapshotMessage(repo)` whenever it
 * changes. Returns a stop function.
 *
 * Meant to be fed by `dataVersion` on a connection to the shared database:
 * SQLite only bumps it for commits made by other connections, so this
 * process's own writes (the bridge makes none) do not trigger a snapshot. A
 * failed read or snapshot is retried on the next tick.
 */
export function broadcastSnapshotsOnChange(
  readVersion: () => number,
  repo: EncounterRepository,
  target: { broadcast(message: BridgeMessage): void },
  options?: { intervalMs?: number },
): () => void {
  let seen = readVersion();
  const timer = setInterval(() => {
    try {
      const version = readVersion();
      if (version === seen) return;
      target.broadcast(snapshotMessage(repo));
      seen = version;
    } catch {
      // Keep `seen` so the next tick retries.
    }
  }, options?.intervalMs ?? SNAPSHOT_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
