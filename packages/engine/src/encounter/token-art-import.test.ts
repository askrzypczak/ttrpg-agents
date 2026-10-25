import { describe, expect, it } from "vitest";
import type { TokenArt, TokenArtRepository } from "./token-art.js";
import { importTokenArt } from "./token-art-import.js";
import {
  validateTokenImage,
  type NewTokenImage,
  type TokenImage,
  type TokenImageRepository,
} from "./token-image.js";

const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const NEW_HASH = "c".repeat(64);
const OLD_HASH = "b".repeat(64);

const publishedArt = (sha256: string): TokenArt => ({
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256,
});

/** An in-memory image repository that records every save and answers a fixed hash. */
function fakeImages(sha256: string) {
  const saved: NewTokenImage[] = [];
  const images: TokenImageRepository = {
    saveTokenImage(image: NewTokenImage): string {
      saved.push(image);
      return sha256;
    },
    getTokenImage(): TokenImage | undefined {
      return undefined;
    },
  };
  return { images, saved };
}

/** An in-memory art repository that records every write. */
function fakeArt(initial: Record<string, TokenArt> = {}) {
  const stored: Record<string, TokenArt> = { ...initial };
  const writes: { monsterKey: string; art: TokenArt }[] = [];
  const art: TokenArtRepository = {
    listTokenArt(): Record<string, TokenArt> {
      return { ...stored };
    },
    setTokenArt(monsterKey: string, value: TokenArt): void {
      writes.push({ monsterKey, art: value });
      stored[monsterKey] = value;
    },
  };
  return { art, stored, writes };
}

/** A byte reader that counts its calls. */
function reader(bytes: Uint8Array) {
  const calls = { count: 0 };
  const read = (): Uint8Array => {
    calls.count += 1;
    return bytes;
  };
  return { read, calls };
}

describe("importTokenArt", () => {
  it("assigns the stored image's hash, with no url, to a key that has no art", () => {
    const { art, stored } = fakeArt();
    const { images, saved } = fakeImages(NEW_HASH);
    const { read } = reader(PNG_1X1);

    const result = importTokenArt(art, images, "srd-2024_goblin", read, {
      replace: false,
    });

    expect(result).toEqual({ outcome: "stored", sha256: NEW_HASH });
    expect(saved).toEqual([
      { mime: "image/png", width: 1, height: 1, bytes: PNG_1X1 },
    ]);
    expect(stored).toEqual({ "srd-2024_goblin": { sha256: NEW_HASH } });
  });

  it("keeps a key's existing art without reading its bytes when replace is off", () => {
    const existing = publishedArt(OLD_HASH);
    const { art, stored, writes } = fakeArt({ "srd-2024_goblin": existing });
    const { images, saved } = fakeImages(NEW_HASH);
    const { read, calls } = reader(PNG_1X1);

    const result = importTokenArt(art, images, "srd-2024_goblin", read, {
      replace: false,
    });

    expect(result).toEqual({ outcome: "skipped", reason: "has_art" });
    expect(calls.count).toBe(0);
    expect(saved).toEqual([]);
    expect(writes).toEqual([]);
    expect(stored).toEqual({ "srd-2024_goblin": existing });
  });

  it("with replace, assigns the new image over the key's existing art", () => {
    const { art, stored } = fakeArt({
      "srd-2024_goblin": publishedArt(OLD_HASH),
    });
    const { images, saved } = fakeImages(NEW_HASH);
    const { read } = reader(PNG_1X1);

    const result = importTokenArt(art, images, "srd-2024_goblin", read, {
      replace: true,
    });

    expect(result).toEqual({ outcome: "stored", sha256: NEW_HASH });
    expect(saved).toHaveLength(1);
    expect(stored).toEqual({ "srd-2024_goblin": { sha256: NEW_HASH } });
  });

  it("with replace, keeps art that already links the same image, published reference included", () => {
    const existing = publishedArt(NEW_HASH);
    const { art, stored, writes } = fakeArt({ "srd-2024_goblin": existing });
    const { images } = fakeImages(NEW_HASH);
    const { read } = reader(PNG_1X1);

    const result = importTokenArt(art, images, "srd-2024_goblin", read, {
      replace: true,
    });

    expect(result).toEqual({ outcome: "skipped", reason: "same_image" });
    expect(writes).toEqual([]);
    expect(stored).toEqual({ "srd-2024_goblin": existing });
  });

  it("rejects bytes that fail validation with the engine's code and message and writes nothing", () => {
    const { art, stored, writes } = fakeArt({
      "srd-2024_wolf": publishedArt(OLD_HASH),
    });
    const { images, saved } = fakeImages(NEW_HASH);
    const notAnImage = new TextEncoder().encode("not an image");
    const validation = validateTokenImage(notAnImage);
    if (validation.ok) throw new Error("expected the bytes to fail validation");

    const fresh = importTokenArt(
      art,
      images,
      "srd-2024_goblin",
      reader(notAnImage).read,
      { replace: false },
    );
    const replacing = importTokenArt(
      art,
      images,
      "srd-2024_wolf",
      reader(notAnImage).read,
      { replace: true },
    );

    const rejection = {
      outcome: "rejected",
      code: "unsupported_type",
      message: validation.message,
    };
    expect(fresh).toEqual(rejection);
    expect(replacing).toEqual(rejection);
    expect(saved).toEqual([]);
    expect(writes).toEqual([]);
    expect(stored).toEqual({ "srd-2024_wolf": publishedArt(OLD_HASH) });
  });
});
