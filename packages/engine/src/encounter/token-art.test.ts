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

  it("accepts art with an image hash and no url, mime, width or height", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    expect(tokenArtSchema.parse({ sha256 })).toEqual({ sha256 });
  });

  it("rejects art with neither a url nor an image hash", () => {
    expect(tokenArtSchema.safeParse({}).success).toBe(false);
    const noUrl = { mime: art.mime, width: art.width, height: art.height };
    expect(tokenArtSchema.safeParse(noUrl).success).toBe(false);
    // Control: the same art with an image hash and no reference is accepted.
    const sha256 = "0123456789abcdef".repeat(4);
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
  });

  it("rejects art with an image hash and only part of url, mime, width and height", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    const fields = ["url", "mime", "width", "height"] as const;
    for (const left of fields) {
      const partial: Record<string, unknown> = { ...art, sha256 };
      delete partial[left];
      expect(tokenArtSchema.safeParse(partial).success, left).toBe(false);
    }
    for (const only of fields)
      expect(
        tokenArtSchema.safeParse({ sha256, [only]: art[only] }).success,
        only,
      ).toBe(false);
    // Control: the hash alone, and the hash with the full reference, are accepted.
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
    expect(tokenArtSchema.safeParse({ ...art, sha256 }).success).toBe(true);
  });

  it("rejects art with an image hash and an invalid url instead of reading it as art without a url", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    const http = { ...art, url: "http://cdn.owlbear.rodeo/shadow.png", sha256 };
    expect(tokenArtSchema.safeParse(http).success).toBe(false);
    expect(
      tokenArtSchema.safeParse({ sha256, url: "javascript:alert(1)" }).success,
    ).toBe(false);
    // Control: the hash alone is art without a url.
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
  });
});
