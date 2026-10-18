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
