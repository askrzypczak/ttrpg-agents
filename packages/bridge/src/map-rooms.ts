import type { EncounterDirectory } from "@ttrpg-agents/engine";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";

const MAP_ROOMS_POLL_INTERVAL_MS = 250;

/**
 * The `map-rooms` message for the current encounter's map: its item id and
 * saved rooms, or a null item id and no rooms when there is no current
 * encounter or it uses no map.
 */
export function mapRoomsMessage(
  encounters: Pick<
    EncounterDirectory,
    "getCurrentEncounter" | "mapRepositoryFor"
  >,
): BridgeMessage {
  const current = encounters.getCurrentEncounter();
  const maps = current && encounters.mapRepositoryFor(current.id);
  const map = maps?.getActiveMap();
  return {
    v: PROTOCOL_VERSION,
    type: "map-rooms",
    payload:
      maps && map
        ? { itemId: map.itemId, rooms: maps.getRooms(map.itemId) }
        : { itemId: null, rooms: [] },
  };
}

/**
 * Polls the current encounter's map and its rooms every 250 ms and broadcasts
 * `map-rooms` when they differ from the last state sent (at first, the state
 * read when polling starts). A failed read is retried on the next tick.
 * Returns a stop function.
 */
export function broadcastMapRooms(
  encounters: Pick<
    EncounterDirectory,
    "getCurrentEncounter" | "mapRepositoryFor"
  >,
  target: { broadcast(message: BridgeMessage): void },
): () => void {
  const read = (): { message: BridgeMessage; key: string } => {
    const message = mapRoomsMessage(encounters);
    return { message, key: JSON.stringify(message.payload) };
  };
  // Undefined when the first read failed: the next successful read is sent.
  let lastSent: string | undefined;
  try {
    lastSent = read().key;
  } catch {
    lastSent = undefined;
  }
  const timer = setInterval(() => {
    let current: { message: BridgeMessage; key: string };
    try {
      current = read();
    } catch {
      // Keep `lastSent` so the next tick retries.
      return;
    }
    if (current.key === lastSent) return;
    target.broadcast(current.message);
    lastSent = current.key;
  }, MAP_ROOMS_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
