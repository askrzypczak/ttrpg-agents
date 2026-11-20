import {
  ImageUnavailableError,
  InvalidTokenRequestError,
  TokeniserError,
} from "./errors.js";
import {
  parseImageLocation,
  type ImageLocation,
  type ImageSource,
} from "./image-source.js";
import {
  validateTokenImage,
  validateTokenSource,
  type TokenImageInfo,
} from "./token-image.js";

/** Fractions (0 to 1) of the source's width and height. */
export interface FocalPoint {
  x: number;
  y: number;
}

/** A square in source pixels (integers). */
export interface SquareCrop {
  left: number;
  top: number;
  side: number;
}

export interface TokenStyle {
  side: number;
  ringWidth: number;
  ringColour: string;
}

/** Driven port: renders tokens from source bytes. Rejects with TokeniserError. */
export interface Tokeniser {
  focalPoint(bytes: Uint8Array): Promise<FocalPoint>;
  renderToken(
    bytes: Uint8Array,
    crop: SquareCrop,
    style: TokenStyle,
  ): Promise<Uint8Array>;
  /** Composes `images` into the layout's cells left to right, top to bottom, each scaled to fit its cell; a null leaves its cell blank. Answers a WebP of columns*cell by rows*cell px with no text. Rejects with TokeniserError. */
  contactSheet(
    images: readonly (Uint8Array | null)[],
    layout: ContactSheetLayout,
  ): Promise<Uint8Array>;
}

/** A contact sheet's grid: `columns` by `rows` cells of `cell` px on an opaque `background` (a #rrggbb colour). */
export interface ContactSheetLayout {
  columns: number;
  rows: number;
  cell: number;
  background: string;
}

/** The engine's sheet: 20 variants a page, 5 columns of 128 px cells, 640 by 512 px, white. */
export const CONTACT_SHEET_LAYOUT: ContactSheetLayout = {
  columns: 5,
  rows: 4,
  cell: 128,
  background: "#ffffff",
};

export const TOKEN_ZOOM_MAX = 8;

export const TOKEN_STYLE: TokenStyle = {
  side: 512,
  ringWidth: 0.03,
  ringColour: "#6e4b2a",
};

/**
 * The square a token shows, in source pixels: its side is the shorter side
 * divided by the zoom (at least 1 px), centred on the focus and moved inside
 * the image where it would cross an edge.
 */
export function tokenCrop(
  size: { width: number; height: number },
  view: { focus: FocalPoint; zoom: number },
): SquareCrop {
  checkView(view);
  const { width, height } = size;
  const { focus, zoom } = view;
  const side = Math.max(1, Math.floor(Math.min(width, height) / zoom));
  return {
    left: centredStart(focus.x * width, side, width),
    top: centredStart(focus.y * height, side, height),
    side,
  };
}

/** Where a span of `side` px centred on `centre` starts, kept within 0..length - side. */
function centredStart(centre: number, side: number, length: number): number {
  return Math.min(Math.max(Math.round(centre - side / 2), 0), length - side);
}

function checkView(view: { focus?: FocalPoint; zoom: number }): void {
  const { focus, zoom } = view;
  if (!within(zoom, 1, TOKEN_ZOOM_MAX))
    throw new InvalidTokenRequestError(
      `Zoom must be a number from 1 to ${String(TOKEN_ZOOM_MAX)}; got ${String(zoom)}.`,
    );
  if (focus === undefined) return;
  for (const axis of ["x", "y"] as const) {
    if (!within(focus[axis], 0, 1))
      throw new InvalidTokenRequestError(
        `Focus ${axis} must be a fraction from 0 to 1; got ${String(focus[axis])}.`,
      );
  }
}

function within(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

export interface MakeTokenDeps {
  imageSource: ImageSource;
  tokeniser: Tokeniser;
}

export interface MadeToken {
  bytes: Uint8Array;
  source: TokenImageInfo;
  focus: FocalPoint;
  zoom: number;
  crop: SquareCrop;
}

/**
 * Makes a token from the image at `image` (an https URL or an absolute file
 * path): checks the focus and zoom, loads and checks the source, crops it at
 * the focus (default: the tokeniser's focal point) and zoom (default 1),
 * renders it with TOKEN_STYLE and checks the output. Stores nothing.
 */
export async function makeToken(
  deps: MakeTokenDeps,
  image: string,
  options: { focus?: FocalPoint; zoom?: number } = {},
): Promise<MadeToken> {
  const zoom = options.zoom ?? 1;
  checkView({ ...options, zoom });
  const location = parseImageLocation(image);
  const bytes = await deps.imageSource.load(location);
  const checked = validateTokenSource(bytes);
  if (!checked.ok)
    throw new ImageUnavailableError(
      `Image ${locationText(location)} is refused: ${checked.message}`,
    );
  const source = checked.image;
  const focus = options.focus ?? (await deps.tokeniser.focalPoint(bytes));
  const crop = tokenCrop(source, { focus, zoom });
  const token = await deps.tokeniser.renderToken(bytes, crop, TOKEN_STYLE);
  checkRendered(token);
  return { bytes: token, source, focus, zoom, crop };
}

function locationText(location: ImageLocation): string {
  return "path" in location ? location.path : location.url;
}

/** A rendered token must pass validateTokenImage and be a TOKEN_STYLE.side square WebP. */
function checkRendered(token: Uint8Array): void {
  const checked = validateTokenImage(token);
  if (!checked.ok)
    throw new TokeniserError(
      `The rendered token failed validation: ${checked.message}`,
    );
  const { mime, width, height } = checked.image;
  const side = TOKEN_STYLE.side;
  if (mime !== "image/webp" || width !== side || height !== side)
    throw new TokeniserError(
      `The rendered token is a ${String(width)} x ${String(height)} px ${mime}, not a ${String(side)} px square WebP.`,
    );
}
