import type { MapRepository } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

const MAP_ROOMS_POLL_INTERVAL_MS = 250;

/**
 * The `map-rooms` message for the active map: its item id and saved rooms, or
 * a null item id and no rooms when no map is in use.
 */
export function mapRoomsMessage(
  maps: Pick<MapRepository, "getActiveMap" | "getRooms">,
): BridgeMessage {
  const active = maps.getActiveMap();
  return {
    v: 1,
    type: "map-rooms",
    payload: active
      ? { itemId: active.itemId, rooms: maps.getRooms(active.itemId) }
      : { itemId: null, rooms: [] },
  };
}

/**
 * Polls the active map's rooms every 250 ms and broadcasts `map-rooms` when
 * they differ from the last state sent (at first, the state read when polling
 * starts). A failed read is retried on the next tick. Returns a stop function.
 */
export function broadcastMapRooms(
  maps: Pick<MapRepository, "getActiveMap" | "getRooms">,
  target: { broadcast(message: BridgeMessage): void },
): () => void {
  const read = (): { message: BridgeMessage; key: string } => {
    const message = mapRoomsMessage(maps);
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
