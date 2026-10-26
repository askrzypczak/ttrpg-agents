// Browser-only drawing for the `map-image` query, on an OffscreenCanvas.
import type { DrawMapImage } from "./map-image.js";

/** Draws the map image, its cell lines and labels per the layout. */
export const drawMapImageOnCanvas: DrawMapImage = () =>
  Promise.reject(new Error("not implemented"));
