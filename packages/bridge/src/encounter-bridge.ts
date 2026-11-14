import {
  DomainError,
  UnknownInstanceError,
  applyInstanceEdit,
  repositoryForInstance,
  type Encounter,
  type EncounterDirectory,
  type EncounterLog,
  type InstanceEdit,
  type TokenArtRepository,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import type { WriteBackResult } from "./server.js";

/**
 * Removes one instance for a `token-deleted` request from the encounter that
 * holds it, current or not: an id no encounter holds as a live instance is a
 * refusal (`unknown-instance`), any other failure is rethrown. The write
 * carries origin source `table` and `commandId`.
 */
export function removeInstance(
  encounters: EncounterDirectory,
  instanceId: string,
  commandId: string,
): WriteBackResult {
  try {
    repositoryForInstance(encounters, instanceId).removeInstances(
      [instanceId],
      { source: "table", commandId },
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof UnknownInstanceError)
      return { ok: false, code: "unknown-instance", message: e.message };
    throw e;
  }
}

/**
 * Applies a table edit for an `instance-edit` request to the encounter that
 * holds the instance, current or not: a domain error (unknown instance,
 * invalid value) is a refusal carrying its code, anything else is
 * rethrown. The writes carry origin source `table` and `commandId`.
 */
export function editInstance(
  encounters: EncounterDirectory,
  edit: InstanceEdit,
  commandId: string,
): WriteBackResult {
  try {
    applyInstanceEdit(
      repositoryForInstance(encounters, edit.instanceId),
      edit,
      { source: "table", commandId },
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError)
      return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/** What a snapshot is for: the open scene and the encounter it shows. */
interface SnapshotScope {
  sceneId: string | null;
  encounter: Encounter | undefined;
}

/**
 * The scope of a snapshot read now: with a scene open, that scene and its
 * bound encounter (none while it is unbound, even when another encounter is
 * current); with none open, no scene and the current encounter. Never writes.
 */
function snapshotScope(encounters: EncounterDirectory): SnapshotScope {
  const open = encounters.getOpenScene();
  if (open) return { sceneId: open.sceneId, encounter: open.encounter };
  return { sceneId: null, encounter: encounters.getCurrentEncounter() };
}

function sameScope(a: SnapshotScope, b: SnapshotScope): boolean {
  return (
    a.sceneId === b.sceneId &&
    a.encounter?.id === b.encounter?.id &&
    a.encounter?.name === b.encounter?.name
  );
}

function buildSnapshot(
  encounters: EncounterDirectory,
  artRepo: TokenArtRepository,
  log: EncounterLog,
): { message: BridgeMessage; scope: SnapshotScope } {
  const seq = log.latestSeq();
  const art = artRepo.listTokenArt();
  const scope = snapshotScope(encounters);
  const { encounter } = scope;
  const repo = encounter ? encounters.repositoryFor(encounter.id) : undefined;
  const instances = repo?.listInstances() ?? [];
  const restoreSeqs = repo?.listRestoreSeqs() ?? {};
  const message: BridgeMessage = {
    v: PROTOCOL_VERSION,
    type: "encounter-snapshot",
    // An empty map is left out, so a store with no art sends what it always did.
    payload: {
      instances,
      ...(Object.keys(art).length > 0 ? { art } : {}),
      ...(Object.keys(restoreSeqs).length > 0 ? { restoreSeqs } : {}),
      seq,
      encounterId: encounter?.id ?? null,
      sceneId: scope.sceneId,
      encounterName: encounter?.name ?? null,
    },
  };
  return { message, scope };
}

/**
 * The snapshot a client converges on: the open scene, the instance list, id
 * and name of the encounter it shows (the open scene's bound one, or with no
 * scene open the current one), and the token art, plus the log position it is
 * current as of. The position is read before the instances, so a commit in
 * between makes the snapshot newer than its `seq` and the client sees that
 * event again as a duplicate or a harmless re-fold, never misses it. Each
 * instance a restore put back is listed in `restoreSeqs` with the seq of its
 * last restore, read after the instances so every restore they reflect is
 * listed; like an empty art map, an empty list is left out. With no such
 * encounter (an open scene with none bound, or no current encounter) the
 * snapshot has no instances and a null id and name; it creates and binds none.
 */
export function snapshotMessage(
  encounters: EncounterDirectory,
  artRepo: TokenArtRepository,
  log: EncounterLog,
): BridgeMessage {
  return buildSnapshot(encounters, artRepo, log).message;
}

/**
 * Builds every snapshot the bridge sends and remembers the scope of the last
 * one built (the open scene, its encounter's id and name).
 */
export interface SnapshotSource {
  /** A snapshot as `snapshotMessage` builds it; its scope is remembered. */
  snapshot(): BridgeMessage;
  /** Whether the scope now differs from the last snapshot built (true before the first). */
  changed(): boolean;
}

export function createSnapshotSource(
  encounters: EncounterDirectory,
  artRepo: TokenArtRepository,
  log: EncounterLog,
): SnapshotSource {
  let last: SnapshotScope | undefined;
  return {
    snapshot() {
      const { message, scope } = buildSnapshot(encounters, artRepo, log);
      last = scope;
      return message;
    },
    changed() {
      return last === undefined || !sameScope(last, snapshotScope(encounters));
    },
  };
}

const LOG_POLL_INTERVAL_MS = 250;

/**
 * Polls the change log and broadcasts every event committed after the log's
 * latest `seq` at the time of the call, as an `encounter-event` carrying its
 * `seq` and `encounterId`, oldest first. Rows from before the bridge started
 * are never read (a client that connects gets a snapshot instead), so an old
 * row this code cannot parse cannot stall it. A row it cannot parse, for
 * example one written by a newer MCP server, is passed over: it is reported
 * once through `onUnreadable`, and when `snapshot` is given it is replaced by a
 * snapshot to every client (the tick's batch ends there and the next tick
 * resumes after the row). Without `snapshot`, the next event's `seq` shows the
 * gap and the extension reconnects for a snapshot. The poll also sees this
 * process's own commits, such as an applied write-back. At the end of each
 * tick, after its events, a snapshot is broadcast when `scopeChanged` says the
 * open scene, its encounter or that encounter's name changed since the last
 * snapshot built (a binding, a rename or a scene opened by another process
 * writes no event). A failed read or broadcast is retried on the next tick
 * from the last event sent. Returns a stop function.
 */
export function broadcastLogEvents(
  log: EncounterLog,
  target: { broadcast(message: BridgeMessage): void },
  options: {
    onUnreadable?: (entry: UnreadableLogEntry) => void;
    snapshot?: () => BridgeMessage;
    scopeChanged?: () => boolean;
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
        const { seq, encounterId, event } = entry;
        target.broadcast({
          v: PROTOCOL_VERSION,
          type: "encounter-event",
          payload: { ...event, seq, encounterId },
        });
        lastSent = seq;
      }
      if (options.snapshot && options.scopeChanged?.() === true)
        target.broadcast(options.snapshot());
    } catch {
      // Keep `lastSent` so the next tick retries.
    }
  }, LOG_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
