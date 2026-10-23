import type { DatabaseSync } from "node:sqlite";
import {
  UnknownInstanceError,
  type EncounterRepository,
  type TokenArtRepository,
} from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import type { RemoveInstanceResult } from "./server.js";

/**
 * Removes one instance for a `token-deleted` request: an unknown id is a
 * refusal (`unknown-instance`), any other failure is rethrown.
 */
export function removeInstance(
  repo: EncounterRepository,
  instanceId: string,
): RemoveInstanceResult {
  try {
    repo.removeInstances([instanceId]);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnknownInstanceError)
      return { ok: false, code: "unknown-instance", message: e.message };
    throw e;
  }
}

/** Full current instance list and token art, for a client that just connected. */
export function snapshotMessage(
  repo: EncounterRepository,
  artRepo: TokenArtRepository,
): BridgeMessage {
  void artRepo;
  return {
    v: 1,
    type: "encounter-snapshot",
    payload: { instances: repo.listInstances() },
  };
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
 * Polls `readVersion` and broadcasts `snapshotMessage(repo, artRepo)` whenever it
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
  artRepo: TokenArtRepository,
  target: { broadcast(message: BridgeMessage): void },
  options?: { intervalMs?: number },
): () => void {
  let seen = readVersion();
  const timer = setInterval(() => {
    try {
      const version = readVersion();
      if (version === seen) return;
      target.broadcast(snapshotMessage(repo, artRepo));
      seen = version;
    } catch {
      // Keep `seen` so the next tick retries.
    }
  }, options?.intervalMs ?? SNAPSHOT_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
