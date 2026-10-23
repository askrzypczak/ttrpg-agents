import { describe, expect, it } from "vitest";
import { tokenArtSchema } from "./token-art.js";

const art = (image: { url?: string; mime?: string }) => ({
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
  ...image,
});

const accepts = (image: { url?: string; mime?: string }) =>
  tokenArtSchema.safeParse(art(image)).success;

describe("tokenArtSchema url and mime shape", () => {
  it("rejects an https url that follows other text", () => {
    expect(accepts({ url: "x https://a.test/i.png" })).toBe(false);
  });

  it("rejects an http url that carries an https url in its query", () => {
    expect(accepts({ url: "http://a.test/?u=https://b.test/i.png" })).toBe(
      false,
    );
  });

  it("rejects a url with whitespace after the host", () => {
    expect(accepts({ url: "https://a.test/a b.png" })).toBe(false);
  });

  it("accepts a one-character host", () => {
    expect(accepts({ url: "https://a/i.png" })).toBe(true);
  });

  it("rejects a url with no host", () => {
    expect(accepts({ url: "https:///i.png" })).toBe(false);
  });

  it("rejects a mime type that only contains image/ later on", () => {
    expect(accepts({ mime: "text/image/png" })).toBe(false);
  });
});
