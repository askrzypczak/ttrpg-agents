import type { MapRepository } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

/**
 * The `map-rooms` message for the active map: its item id and saved rooms, or
 * a null item id and no rooms when no map is in use.
 */
export function mapRoomsMessage(
  maps: Pick<MapRepository, "getActiveMap" | "getRooms">,
): BridgeMessage {
  void maps;
  throw new Error("not implemented");
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
  void maps;
  void target;
  throw new Error("not implemented");
}
