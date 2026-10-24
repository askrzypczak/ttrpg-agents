/** The largest image the store accepts, in bytes. */
export const TOKEN_IMAGE_MAX_BYTES = 1024 * 1024;

/** The largest width or height the store accepts, in pixels. */
export const TOKEN_IMAGE_MAX_SIDE = 2048;

export type TokenImageMime = "image/png" | "image/jpeg" | "image/webp";

export type TokenImageInfo = {
  mime: TokenImageMime;
  width: number;
  height: number;
};

export type TokenImageErrorCode =
  | "too_large"
  | "svg"
  | "unsupported_type"
  | "unreadable"
  | "dimensions_too_large";

export type TokenImageValidation =
  | { ok: true; image: TokenImageInfo }
  | { ok: false; code: TokenImageErrorCode; message: string };

/** Checks image bytes against the allow-list and caps; the claimed type is never an input. */
export function validateTokenImage(bytes: Uint8Array): TokenImageValidation {
  void bytes;
  throw new Error("not implemented");
}

export type NewTokenImage = TokenImageInfo & { bytes: Uint8Array };

export type TokenImage = NewTokenImage & { sha256: string };

/** Token image bytes by content hash. */
export interface TokenImageRepository {
  /** Stores bytes that passed validateTokenImage under their SHA-256 (lowercase hex) and returns it; the same bytes again is a no-op. */
  saveTokenImage(image: NewTokenImage): string;
  /** The stored image with that hash, or undefined. */
  getTokenImage(sha256: string): TokenImage | undefined;
}
