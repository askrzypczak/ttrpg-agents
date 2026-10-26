// Pure planning and encoding for the `map-image` query: what to draw where,
// and which encoding fits the bridge's message cap. The browser drawing is in
// map-image-canvas.ts.
import type { MapPlacement } from "@ttrpg-agents/engine";
import { MAX_MESSAGE_BYTES } from "@ttrpg-agents/protocol";

/**
 * The most image bytes a `map-image` reply may carry: base64 grows them by
 * 4/3, and 4096 bytes are left for the rest of the message.
 */
export const MAP_IMAGE_MAX_BYTES: number =
  Math.floor((MAX_MESSAGE_BYTES - 4096) / 4) * 3;

/** What to draw for one map image, in output px. */
export interface MapImageLayout {
  width: number;
  height: number;
  cellPx: number;
  image: {
    width: number;
    height: number;
    transform: [number, number, number, number, number, number];
  };
  clip: { x: number; y: number; width: number; height: number };
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  labels: { text: string; x: number; y: number }[];
  fontSize: number;
  lineWidth: number;
}

/** The layout of the map image for this placement. */
export function planMapImage(placement: MapPlacement): MapImageLayout {
  void placement;
  throw new Error("not implemented");
}

/** An encoded map image. */
export interface EncodedMapImage {
  mimeType: "image/webp" | "image/jpeg";
  bytes: Uint8Array;
}

/**
 * Encodes the drawn image as `type` at `quality`; answers the type the
 * browser actually produced.
 */
export type ConvertMapImage = (
  type: "image/webp" | "image/jpeg",
  quality: number,
) => Promise<{ type: string; bytes: Uint8Array }>;

/** Draws `image` per `layout`, answering how to encode the result. */
export type DrawMapImage = (
  image: { bytes: Uint8Array; mime: string },
  layout: MapImageLayout,
) => Promise<ConvertMapImage>;

/** The first encoding of the drawn image that fits `MAP_IMAGE_MAX_BYTES`. */
export function encodeWithinBudget(
  convert: ConvertMapImage,
): Promise<EncodedMapImage> {
  void convert;
  return Promise.reject(new Error("not implemented"));
}

/** Standard base64 of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  void bytes;
  throw new Error("not implemented");
}
