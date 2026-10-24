import { describe, expect, it } from "vitest";
import { TOKEN_IMAGE_MAX_BYTES, validateTokenImage } from "./token-image.js";

const fromBase64 = (b64: string): Uint8Array =>
  new Uint8Array(Buffer.from(b64, "base64"));

// 1x1 images, one per accepted format.
const PNG_1X1 = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);
const JPEG_1X1 = fromBase64(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A7iiiiv8AQA+XP//Z",
);
const WEBP_1X1 = fromBase64("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==");

// A lossy WebP header (RIFF, VP8 chunk, frame tag, start code, 1x1).
const WEBP_LOSSY_1X1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  0x38, 0x20, 10, 0, 0, 0, 0x10, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0,
]);

/** A PNG signature and IHDR declaring the given size, zero-padded to `length` bytes. */
function pngDeclaring(width: number, height: number, length = 33): Uint8Array {
  const out = new Uint8Array(length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function rejectionOf(bytes: Uint8Array) {
  const result = validateTokenImage(bytes);
  if (result.ok) throw new Error("expected the image to be rejected");
  return result;
}

describe("validateTokenImage", () => {
  it("accepts a PNG and reports its mime, width and height", () => {
    expect(validateTokenImage(PNG_1X1)).toEqual({
      ok: true,
      image: { mime: "image/png", width: 1, height: 1 },
    });
    expect(validateTokenImage(pngDeclaring(300, 280))).toEqual({
      ok: true,
      image: { mime: "image/png", width: 300, height: 280 },
    });
  });

  it("accepts a JPEG and reports its mime, width and height", () => {
    expect(validateTokenImage(JPEG_1X1)).toEqual({
      ok: true,
      image: { mime: "image/jpeg", width: 1, height: 1 },
    });
  });

  it("accepts a WebP and reports its mime, width and height", () => {
    expect(validateTokenImage(WEBP_1X1)).toEqual({
      ok: true,
      image: { mime: "image/webp", width: 1, height: 1 },
    });
  });

  it("accepts an image of exactly 1 MiB with 2048 px on the longer side", () => {
    const bytes = pngDeclaring(2048, 1, TOKEN_IMAGE_MAX_BYTES);
    expect(bytes).toHaveLength(1024 * 1024);
    expect(validateTokenImage(bytes)).toEqual({
      ok: true,
      image: { mime: "image/png", width: 2048, height: 1 },
    });
    expect(validateTokenImage(pngDeclaring(1, 2048))).toMatchObject({
      ok: true,
      image: { width: 1, height: 2048 },
    });
  });

  it("rejects bytes over 1 MiB with too_large", () => {
    const bytes = pngDeclaring(2048, 1, TOKEN_IMAGE_MAX_BYTES + 1);
    expect(rejectionOf(bytes).code).toBe("too_large");
    // Control: the same image one byte shorter is accepted.
    expect(
      validateTokenImage(pngDeclaring(2048, 1, TOKEN_IMAGE_MAX_BYTES)).ok,
    ).toBe(true);
  });

  it("rejects an image whose longer side is over 2048 px with dimensions_too_large", () => {
    expect(rejectionOf(pngDeclaring(2049, 1)).code).toBe(
      "dimensions_too_large",
    );
    expect(rejectionOf(pngDeclaring(1, 2049)).code).toBe(
      "dimensions_too_large",
    );
    expect(rejectionOf(pngDeclaring(4000, 4000)).code).toBe(
      "dimensions_too_large",
    );
  });

  it("rejects SVG with svg", () => {
    const svg = text(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect(rejectionOf(svg).code).toBe("svg");
    const withProlog = text(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    expect(rejectionOf(withProlog).code).toBe("svg");
  });

  it("rejects GIF and unknown bytes with unsupported_type", () => {
    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x00, 0x3b,
    ]);
    expect(rejectionOf(gif).code).toBe("unsupported_type");
    const unknown = new Uint8Array(64).map((_, i) => (i * 7 + 3) % 251);
    expect(rejectionOf(unknown).code).toBe("unsupported_type");
  });

  it("rejects PNG, JPEG and WebP headers cut short with unreadable", () => {
    // Cut inside each header: before the PNG height, before the JPEG frame
    // header, and before the WebP frame size.
    expect(rejectionOf(PNG_1X1.slice(0, 20)).code).toBe("unreadable");
    expect(rejectionOf(JPEG_1X1.slice(0, 30)).code).toBe("unreadable");
    expect(rejectionOf(WEBP_LOSSY_1X1.slice(0, 28)).code).toBe("unreadable");
    // Control: the uncut WebP header is accepted.
    expect(validateTokenImage(WEBP_LOSSY_1X1).ok).toBe(true);
  });

  it("rejects a header that declares a zero width or height with unreadable", () => {
    expect(rejectionOf(pngDeclaring(0, 10)).code).toBe("unreadable");
    expect(rejectionOf(pngDeclaring(10, 0)).code).toBe("unreadable");
  });
});
