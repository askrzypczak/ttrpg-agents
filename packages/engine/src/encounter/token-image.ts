import { imageSize } from "image-size";
import { SVG } from "image-size/types/svg";

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

const UNSUPPORTED_TYPE = "Unsupported image type. Use PNG, JPEG or WebP.";
const UNREADABLE = "Image is truncated or its header is corrupt.";

/** The library's detected type names for the image types on the allow-list. */
const MIME_BY_TYPE = new Map<string | undefined, TokenImageMime>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["webp", "image/webp"],
]);

/** Checks image bytes against the allow-list and caps; the claimed type is never an input. */
export function validateTokenImage(bytes: Uint8Array): TokenImageValidation {
  if (bytes.byteLength > TOKEN_IMAGE_MAX_BYTES)
    return reject("too_large", "Image is larger than 1 MiB.");
  // The library's SVG check runs on the first bytes only, so an SVG whose
  // size cannot be measured is still identified as SVG here.
  if (SVG.validate(bytes))
    return reject("svg", "SVG images are not accepted. Use PNG, JPEG or WebP.");
  let size: ReturnType<typeof imageSize>;
  try {
    // Some readers in the library bound-check against the whole backing buffer,
    // so a view is copied first and a header cut short fails here.
    size = imageSize(bytes.slice());
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("unsupported file type")
    )
      return reject("unsupported_type", UNSUPPORTED_TYPE);
    return reject("unreadable", UNREADABLE);
  }
  const mime = MIME_BY_TYPE.get(size.type);
  if (mime === undefined) return reject("unsupported_type", UNSUPPORTED_TYPE);
  const { width, height } = size;
  if (!isPositiveInteger(width) || !isPositiveInteger(height))
    return reject("unreadable", UNREADABLE);
  if (Math.max(width, height) > TOKEN_IMAGE_MAX_SIDE)
    return reject(
      "dimensions_too_large",
      `Image sides must be at most ${TOKEN_IMAGE_MAX_SIDE} px.`,
    );
  return { ok: true, image: { mime, width, height } };
}

function reject(
  code: TokenImageErrorCode,
  message: string,
): TokenImageValidation {
  return { ok: false, code, message };
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
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

export type TokenImageStoreResult =
  | { ok: true; sha256: string; image: TokenImageInfo }
  | { ok: false; code: TokenImageErrorCode; message: string };

/** Validates the bytes and stores them when they pass; stores nothing otherwise. */
export function storeTokenImage(
  repo: TokenImageRepository,
  bytes: Uint8Array,
): TokenImageStoreResult {
  const validation = validateTokenImage(bytes);
  if (!validation.ok) return validation;
  const { image } = validation;
  const sha256 = repo.saveTokenImage({ ...image, bytes });
  return { ok: true, sha256, image };
}
