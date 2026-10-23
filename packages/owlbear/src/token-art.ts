import type { TokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

/**
 * The `token-art-set` request that stores the art the GM picked for a monster
 * type. It has no envelope id: nothing reads a reply.
 */
export function tokenArtMessage(
  monsterKey: string,
  art: TokenArt,
): BridgeMessage {
  void monsterKey;
  void art;
  throw new Error("not implemented");
}
