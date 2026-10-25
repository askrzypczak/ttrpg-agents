import type { TokenArt } from "@ttrpg-agents/engine";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";

/**
 * The `token-art-set` request that stores the art the GM picked for a monster
 * type. It has no envelope id: nothing reads a reply.
 */
export function tokenArtMessage(
  monsterKey: string,
  art: TokenArt,
): BridgeMessage {
  return { v: 1, type: "token-art-set", payload: { monsterKey, art } };
}

/**
 * Posts image bytes to the bridge's token image route with the extension
 * token as a bearer. Resolves with the bridge's answer, a stored image or a
 * refusal; rejects when the answer is not an upload response.
 */
export function uploadTokenImage(
  bytes: Uint8Array,
  token: string,
): Promise<TokenImageUploadResponse> {
  void bytes;
  void token;
  return Promise.reject(new Error("not implemented"));
}
