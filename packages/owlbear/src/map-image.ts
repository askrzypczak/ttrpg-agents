// Pure planning and encoding for the `map-image` query: what to draw where,
// and which encoding fits the bridge's message cap. The browser drawing is in
// map-image-canvas.ts.
import {
  displayGrid,
  formatColumnLabel,
  mapTransform,
  type MapPlacement,
} from "@ttrpg-agents/engine";
import { MAX_MESSAGE_BYTES } from "@ttrpg-agents/protocol";

/** The longest side of the drawn image, margin included, in px. */
const MAX_SIDE_PX = 1600;
/** The labelled margin around the grid, in cells. */
const MARGIN_CELLS = 1;
/** Encoding qualities, tried in order until one fits the budget. */
const QUALITIES = [0.85, 0.7, 0.5] as const;
/** Bytes per `String.fromCharCode` call in `bytesToBase64`. */
const BASE64_CHUNK = 0x8000;

/**
 * The most image bytes a `map-image` reply may carry: base64 grows them by
 * 4/3, and 4096 bytes of `MAX_MESSAGE_BYTES` are left for the rest of the
 * message (the envelope, the mime type and the size), so the reply stays
 * under the bridge's `maxPayload`.
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

/**
 * The layout of the map image for this placement: the engine's display grid
 * in whole-pixel cells inside a one-cell labelled margin, and the map drawn as
 * the DM sees it (rotation and scale applied), clipped to the grid.
 * `image.transform` maps source image px to output px, in canvas
 * `setTransform(a, b, c, d, e, f)` order.
 */
export function planMapImage(placement: MapPlacement): MapImageLayout {
  const grid = displayGrid(placement);
  const transform = mapTransform(placement);
  const { cols, rows } = grid;
  const cellPx = Math.floor(
    MAX_SIDE_PX / (Math.max(cols, rows) + 2 * MARGIN_CELLS),
  );
  const margin = MARGIN_CELLS * cellPx;
  const right = margin + cols * cellPx;
  const bottom = margin + rows * cellPx;

  const lines: MapImageLayout["lines"] = [];
  for (let c = 0; c <= cols; c++) {
    const x = margin + c * cellPx;
    lines.push({ x1: x, y1: margin, x2: x, y2: bottom });
  }
  for (let r = 0; r <= rows; r++) {
    const y = margin + r * cellPx;
    lines.push({ x1: margin, y1: y, x2: right, y2: y });
  }

  const labels: MapImageLayout["labels"] = [];
  for (let c = 0; c < cols; c++) {
    const text = formatColumnLabel(c);
    const x = margin + (c + 0.5) * cellPx;
    labels.push(
      { text, x, y: margin / 2 },
      { text, x, y: bottom + margin / 2 },
    );
  }
  for (let r = 0; r < rows; r++) {
    const text = String(r + 1);
    const y = margin + (r + 0.5) * cellPx;
    labels.push({ text, x: margin / 2, y }, { text, x: right + margin / 2, y });
  }

  // Image px -> scene units is affine, so three points fix it; scene units ->
  // output px puts the grid's top-left corner on the clip's top-left corner.
  const o = transform.imageToScene({ x: 0, y: 0 });
  const ex = transform.imageToScene({ x: 1, y: 0 });
  const ey = transform.imageToScene({ x: 0, y: 1 });
  const d = placement.sceneDpi;
  const s = cellPx / d;
  const gridLeft = grid.origin.col * d;
  const gridTop = grid.origin.row * d;

  return {
    width: right + margin,
    height: bottom + margin,
    cellPx,
    image: {
      width: placement.imageWidth,
      height: placement.imageHeight,
      transform: [
        (ex.x - o.x) * s,
        (ex.y - o.y) * s,
        (ey.x - o.x) * s,
        (ey.y - o.y) * s,
        margin + (o.x - gridLeft) * s,
        margin + (o.y - gridTop) * s,
      ],
    },
    clip: { x: margin, y: margin, width: cols * cellPx, height: rows * cellPx },
    lines,
    labels,
    fontSize: Math.round(cellPx * 0.45),
    lineWidth: Math.max(1, Math.round(cellPx / 24)),
  };
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

/**
 * The first encoding of the drawn image that fits `MAP_IMAGE_MAX_BYTES`, at
 * decreasing quality: WEBP, or JPEG at the same quality when the browser
 * answers another type for WEBP. Fails when no quality fits.
 */
export async function encodeWithinBudget(
  convert: ConvertMapImage,
): Promise<EncodedMapImage> {
  let smallest = Infinity;
  for (const quality of QUALITIES) {
    const webp = await convert("image/webp", quality);
    const encoded: EncodedMapImage =
      webp.type === "image/webp"
        ? { mimeType: "image/webp", bytes: webp.bytes }
        : {
            mimeType: "image/jpeg",
            bytes: (await convert("image/jpeg", quality)).bytes,
          };
    if (encoded.bytes.length <= MAP_IMAGE_MAX_BYTES) return encoded;
    smallest = Math.min(smallest, encoded.bytes.length);
  }
  throw new Error(
    `The map image is too large to send: ${String(smallest)} bytes at best, over the ${String(MAP_IMAGE_MAX_BYTES)}-byte limit.`,
  );
}

/** Standard base64 of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}
