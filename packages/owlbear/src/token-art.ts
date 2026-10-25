import type { TokenArt } from "@ttrpg-agents/engine";
import {
  TOKEN_IMAGE_UPLOAD_PATH,
  tokenImagePath,
  tokenImageReadErrorSchema,
  tokenImageUploadResponseSchema,
  type BridgeMessage,
  type TokenImageUploadResponse,
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
export async function uploadTokenImage(
  bytes: Uint8Array,
  token: string,
): Promise<TokenImageUploadResponse> {
  // Relative: the panel is served by the bridge, so this stays same-origin.
  const response = await fetch(TOKEN_IMAGE_UPLOAD_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    // A copy over a plain ArrayBuffer, the only kind fetch takes as a body.
    body: new Uint8Array(bytes),
  });
  // A refusal is a typed answer too, whatever its status.
  return tokenImageUploadResponseSchema.parse(await response.json());
}

/** The bytes of a token image stored on the bridge, with their mime type. */
export type StoredTokenImage = { bytes: Uint8Array; mime: string };

/**
 * Gets the stored bytes of a token image from the bridge with the extension
 * token as a bearer. Rejects with the bridge's message when it refuses.
 */
export async function downloadTokenImage(
  sha256: string,
  token: string,
): Promise<StoredTokenImage> {
  // Relative: the panel is served by the bridge, so this stays same-origin.
  const response = await fetch(tokenImagePath(sha256), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.ok)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("Content-Type") ?? "",
    };
  const refusal = tokenImageReadErrorSchema.parse(await response.json());
  throw new Error(refusal.error.message);
}

/** The Owlbear asset name a stored token image is uploaded again under. */
export function republishName(sha256: string): string {
  return `ttrpg-art-${sha256.slice(0, 16)}`;
}
