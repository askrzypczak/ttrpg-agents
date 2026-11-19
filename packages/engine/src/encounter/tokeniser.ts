import type { ImageSource } from "./image-source.js";
import type { TokenImageInfo } from "./token-image.js";

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
}

export const TOKEN_ZOOM_MAX = 8;

export const TOKEN_STYLE: TokenStyle = {
  side: 512,
  ringWidth: 0.03,
  ringColour: "#6e4b2a",
};

export function tokenCrop(
  size: { width: number; height: number },
  view: { focus: FocalPoint; zoom: number },
): SquareCrop {
  void size;
  void view;
  throw new Error("not implemented");
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

export function makeToken(
  deps: MakeTokenDeps,
  image: string,
  options?: { focus?: FocalPoint; zoom?: number },
): Promise<MadeToken> {
  void deps;
  void image;
  void options;
  return Promise.reject(new Error("not implemented"));
}
