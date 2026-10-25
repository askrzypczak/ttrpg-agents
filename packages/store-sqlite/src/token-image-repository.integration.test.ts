import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NewTokenImage } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteTokenImageRepository } from "./token-image-repository.js";

// SHA-256 of the ASCII bytes "abc".
const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const abc: NewTokenImage = {
  bytes: new TextEncoder().encode("abc"),
  mime: "image/png",
  width: 3,
  height: 2,
};

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("SqliteTokenImageRepository", () => {
  it("stores image bytes and reads them back by their SHA-256", () => {
    const repo = new SqliteTokenImageRepository(openDatabase(":memory:"));
    const image: NewTokenImage = {
      bytes: png,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    const sha256 = repo.saveTokenImage(image);
    const stored = repo.getTokenImage(sha256);
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      sha256,
      mime: "image/png",
      width: 1,
      height: 1,
    });
    expect(Array.from(stored?.bytes ?? [])).toEqual(Array.from(png));
  });

  it("returns the SHA-256 of the bytes as lowercase hex", () => {
    const repo = new SqliteTokenImageRepository(openDatabase(":memory:"));
    expect(repo.saveTokenImage(abc)).toBe(ABC_SHA256);
    const other = { ...abc, bytes: png };
    expect(repo.saveTokenImage(other)).toBe(
      createHash("sha256").update(png).digest("hex"),
    );
  });

  it("storing the same bytes twice keeps one row and returns the same hash", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenImageRepository(db);
    const first = repo.saveTokenImage(abc);
    const second = repo.saveTokenImage({ ...abc });
    expect(second).toBe(first);
    expect(first).toBe(ABC_SHA256);
    expect(
      db.prepare("SELECT count(*) AS n FROM token_art_image").get(),
    ).toEqual({ n: 1 });
  });

  it("reads nothing for an unknown hash", () => {
    const repo = new SqliteTokenImageRepository(openDatabase(":memory:"));
    repo.saveTokenImage(abc);
    expect(repo.getTokenImage("0".repeat(64))).toBeUndefined();
    // Control: the stored hash is found.
    expect(repo.getTokenImage(ABC_SHA256)).toBeDefined();
  });
});
