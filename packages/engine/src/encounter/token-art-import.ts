import type { TokenArtRepository } from "./token-art.js";
import type {
  TokenImageErrorCode,
  TokenImageRepository,
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
  void art;
  void images;
  void monsterKey;
  void readBytes;
  void options;
  throw new Error("not implemented");
}
