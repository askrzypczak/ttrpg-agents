import {
  DomainError,
  UnknownInstanceError,
  applyInstanceEdit,
  type EncounterLog,
  type EncounterRepository,
  type InstanceEdit,
  type TokenArtRepository,
  type UnreadableLogEntry,
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

/**
 * Full current instance list and token art, for a client that just connected,
 * plus the log position it is current as of. The position is read before the
 * instances, so a commit in between makes the snapshot newer than its `seq`
 * and the client sees that event again as a duplicate or a harmless re-fold,
 * never misses it.
 */
export function snapshotMessage(
  repo: EncounterRepository,
  artRepo: TokenArtRepository,
  log: EncounterLog,
): BridgeMessage {
  const seq = log.latestSeq();
  const art = artRepo.listTokenArt();
  return {
    v: 1,
    type: "encounter-snapshot",
    // An empty map is left out, so a store with no art sends what it always did.
    payload: {
      instances: repo.listInstances(),
      ...(Object.keys(art).length > 0 ? { art } : {}),
      seq,
    },
  };
}

const LOG_POLL_INTERVAL_MS = 250;

/**
 * Polls the change log and broadcasts every event committed after the log's
 * latest `seq` at the time of the call, as an `encounter-event` carrying its
 * `seq`, oldest first. Rows from before the bridge started are never read
 * (a client that connects gets a snapshot instead), so an old row this code
 * cannot parse cannot stall it. A row it cannot parse, for example one written
 * by a newer MCP server, is passed over: it is reported once through
 * `onUnreadable`, and when `snapshot` is given it is replaced by a snapshot to
 * every client (the tick's batch ends there and the next tick resumes after
 * the row). Without `snapshot`, the next event's `seq` shows the gap and the
 * extension reconnects for a snapshot. The poll also sees this process's own
 * commits, such as an applied write-back. A failed read or broadcast is retried
 * on the next tick from the last event sent. Returns a stop function.
 */
export function broadcastLogEvents(
  log: EncounterLog,
  target: { broadcast(message: BridgeMessage): void },
  options: {
    onUnreadable?: (entry: UnreadableLogEntry) => void;
    snapshot?: () => BridgeMessage;
  } = {},
): () => void {
  let lastSent = log.latestSeq();
  const timer = setInterval(() => {
    try {
      for (const entry of log.eventsSince(lastSent)) {
        if (!("event" in entry)) {
          lastSent = entry.seq;
          options.onUnreadable?.(entry);
          if (!options.snapshot) continue;
          target.broadcast(options.snapshot());
          break;
        }
        const { seq, event } = entry;
        target.broadcast({
          v: 1,
          type: "encounter-event",
          payload: { ...event, seq },
        });
        lastSent = seq;
      }
    } catch {
      // Keep `lastSent` so the next tick retries.
    }
  }, LOG_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
