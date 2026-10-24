import type { DatabaseSync } from "node:sqlite";
import {
  DomainError,
  UnknownInstanceError,
  applyInstanceEdit,
  type EncounterLog,
  type EncounterRepository,
  type InstanceEdit,
  type TokenArtRepository,
} from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import type { WriteBackResult } from "./server.js";

/**
 * Removes one instance for a `token-deleted` request: an unknown id is a
 * refusal (`unknown-instance`), any other failure is rethrown. The write
 * carries origin source `table` and `commandId`.
 */
export function removeInstance(
  repo: EncounterRepository,
  instanceId: string,
  commandId: string,
): WriteBackResult {
  try {
    repo.removeInstances([instanceId], { source: "table", commandId });
    return { ok: true };
  } catch (e) {
    if (e instanceof UnknownInstanceError)
      return { ok: false, code: "unknown-instance", message: e.message };
    throw e;
  }
}

/**
 * Applies a table edit for an `instance-edit` request: a domain error (unknown
 * instance, invalid value) is a refusal carrying its code, anything else is
 * rethrown. The writes carry origin source `table` and `commandId`.
 */
export function editInstance(
  repo: EncounterRepository,
  edit: InstanceEdit,
  commandId: string,
): WriteBackResult {
  try {
    applyInstanceEdit(repo, edit, { source: "table", commandId });
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError)
      return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/** Full current instance list and token art, for a client that just connected. */
export function snapshotMessage(
  repo: EncounterRepository,
  artRepo: TokenArtRepository,
  log: EncounterLog,
): BridgeMessage {
  void log;
  const art = artRepo.listTokenArt();
  return {
    v: 1,
    type: "encounter-snapshot",
    // An empty map is left out, so a store with no art sends what it always did.
    payload: {
      instances: repo.listInstances(),
      ...(Object.keys(art).length > 0 ? { art } : {}),
    },
  };
}

/**
 * Polls the change log and broadcasts every event committed after the log's
 * latest `seq` at the time of the call, as an `encounter-event` carrying its
 * `seq`, oldest first. A failed read is retried on the next tick. Returns a
 * stop function.
 */
export function broadcastLogEvents(
  log: EncounterLog,
  target: { broadcast(message: BridgeMessage): void },
): () => void {
  void log;
  void target;
  throw new Error("not implemented");
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
 * process's own writes (token art and removals) do not trigger one; the
 * bridge sends those snapshots directly. A failed read or snapshot is
 * retried on the next tick.
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
      // Stub: this poller is replaced by `broadcastLogEvents`.
      const emptyLog: EncounterLog = {
        latestSeq: () => 0,
        eventsSince: () => [],
      };
      target.broadcast(snapshotMessage(repo, artRepo, emptyLog));
      seen = version;
    } catch {
      // Keep `seen` so the next tick retries.
    }
  }, options?.intervalMs ?? SNAPSHOT_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
