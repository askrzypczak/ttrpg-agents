import type { TokenArtRepository } from "./token-art.js";
import {
  storeTokenImage,
  type TokenImageErrorCode,
  type TokenImageRepository,
} from "./token-image.js";

export type TokenArtImportResult =
  | { outcome: "stored"; sha256: string }
  | { outcome: "skipped"; reason: "has_art" | "same_image" }
  | { outcome: "rejected"; code: TokenImageErrorCode; message: string };

/**
 * Stores an image and assigns it to a monster key (an opaque string) as art
 * without a url ({ sha256 }). A key that has art keeps it unless `replace`;
 * with `replace`, art that already links the same image is kept too, so its
 * published reference survives. `readBytes` is called only when the art may
 * change; the bytes go through `storeTokenImage`.
 */
export function importTokenArt(
  art: TokenArtRepository,
  images: TokenImageRepository,
  monsterKey: string,
  readBytes: () => Uint8Array,
  options: { replace: boolean },
): TokenArtImportResult {
  const all = art.listTokenArt();
  const existing = Object.hasOwn(all, monsterKey) ? all[monsterKey] : undefined;
  if (existing !== undefined && !options.replace)
    return { outcome: "skipped", reason: "has_art" };

  const result = storeTokenImage(images, readBytes());
  if (!result.ok)
    return { outcome: "rejected", code: result.code, message: result.message };

  if (existing?.sha256 === result.sha256)
    return { outcome: "skipped", reason: "same_image" };

  art.setTokenArt(monsterKey, { sha256: result.sha256 });
  return { outcome: "stored", sha256: result.sha256 };
}
