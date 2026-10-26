// Browser-only drawing for the `map-image` query, on an OffscreenCanvas. The
// map's bytes are fetched, and a bitmap made from a fetched Blob is
// origin-clean, so the cross-origin CDN image never taints the canvas and
// `convertToBlob` can always read it back.
import type { DrawMapImage } from "./map-image.js";

/** Reads on light and dark maps alike. */
const LINE_COLOUR = "rgba(220, 0, 0, 0.7)";

/** Draws the map image, its cell lines and labels per the layout. */
export const drawMapImageOnCanvas: DrawMapImage = async (
  { bytes, mime },
  layout,
) => {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: mime }),
  );
  const canvas = new OffscreenCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser cannot draw the map image.");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.save();
  const { clip } = layout;
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.width, clip.height);
  ctx.clip();
  ctx.setTransform(...layout.image.transform);
  ctx.drawImage(bitmap, 0, 0, layout.image.width, layout.image.height);
  ctx.restore();
  bitmap.close();

  ctx.strokeStyle = LINE_COLOUR;
  ctx.lineWidth = layout.lineWidth;
  ctx.beginPath();
  for (const line of layout.lines) {
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
  }
  ctx.stroke();

  ctx.fillStyle = "black";
  ctx.font = `bold ${String(layout.fontSize)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of layout.labels) {
    ctx.fillText(label.text, label.x, label.y);
  }

  return async (type, quality) => {
    const blob = await canvas.convertToBlob({ type, quality });
    return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
  };
};
