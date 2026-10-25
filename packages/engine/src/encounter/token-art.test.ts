import { describe, expect, it } from "vitest";
import { tokenArtSchema } from "./token-art.js";

const art = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const withImage = (over: Partial<typeof art>) => ({
  ...art,
  ...over,
});

describe("tokenArtSchema", () => {
  it("accepts an https image reference", () => {
    expect(tokenArtSchema.parse(art)).toEqual(art);
  });

  it("accepts art with an image hash of 64 lowercase hex characters", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    expect(sha256).toHaveLength(64);
    expect(tokenArtSchema.parse({ ...art, sha256 })).toEqual({
      ...art,
      sha256,
    });
  });

  it("rejects an image hash that is not 64 lowercase hex characters", () => {
    const valid = "0123456789abcdef".repeat(4);
    for (const sha256 of [
      valid.slice(1),
      valid + "0",
      valid.toUpperCase(),
      "g".repeat(64),
      "",
    ])
      expect(tokenArtSchema.safeParse({ ...art, sha256 }).success).toBe(false);
    // Control: the valid hash is accepted.
    expect(tokenArtSchema.safeParse({ ...art, sha256: valid }).success).toBe(
      true,
    );
  });

  it("rejects a url that is not https", () => {
    const http = withImage({ url: "http://cdn.owlbear.rodeo/shadow.png" });
    const script = withImage({ url: "javascript:alert(1)" });
    expect(tokenArtSchema.safeParse(http).success).toBe(false);
    expect(tokenArtSchema.safeParse(script).success).toBe(false);
    // Control: the same reference over https is accepted.
    const https = withImage({ url: "https://cdn.owlbear.rodeo/shadow.png" });
    expect(tokenArtSchema.safeParse(https).success).toBe(true);
  });

  it("rejects a url over the length bound", () => {
    const base = "https://cdn.owlbear.rodeo/";
    const atBound = base + "a".repeat(2048 - base.length);
    expect(atBound).toHaveLength(2048);
    expect(tokenArtSchema.safeParse(withImage({ url: atBound })).success).toBe(
      true,
    );
    expect(
      tokenArtSchema.safeParse(withImage({ url: atBound + "a" })).success,
    ).toBe(false);
  });

  it("rejects a mime type that is not an image", () => {
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "text/html" })).success,
    ).toBe(false);
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "application/javascript" }))
        .success,
    ).toBe(false);
    // Control: another image type is accepted.
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "image/webp" })).success,
    ).toBe(true);
  });
});
