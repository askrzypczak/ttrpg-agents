import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import {
  PROTOCOL_VERSION,
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
  art: PublishedTokenArt,
): BridgeMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "token-art-set",
    payload: { monsterKey, art },
  };
}

/**
 * Posts image bytes to the bridge's token image route. The bridge admits it by
 * the request's `Origin`, which the browser sets to the panel's (the bridge's
 * own). Resolves with the bridge's answer, a stored image or a refusal;
 * rejects when the answer is not an upload response.
 */
export async function uploadTokenImage(
  bytes: Uint8Array,
): Promise<TokenImageUploadResponse> {
  // Relative: the panel is served by the bridge, so this stays same-origin.
  const response = await fetch(TOKEN_IMAGE_UPLOAD_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    // A copy over a plain ArrayBuffer, the only kind fetch takes as a body.
    body: new Uint8Array(bytes),
  });
  // A refusal is a typed answer too, whatever its status.
  return tokenImageUploadResponseSchema.parse(await response.json());
}

/** The bytes of a token image stored on the bridge, with their mime type. */
export type StoredTokenImage = { bytes: Uint8Array; mime: string };

/**
 * Gets the stored bytes of a token image from the bridge. Rejects with the
 * bridge's message when it refuses.
 */
export async function downloadTokenImage(
  sha256: string,
): Promise<StoredTokenImage> {
  // Relative: the panel is served by the bridge, so this stays same-origin.
  const response = await fetch(tokenImagePath(sha256));
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
