import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { validateTokenImage } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import {
  formatTokenArtImportSummary,
  importTokenArtLibrary,
} from "./token-art-import.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";
import { SqliteTokenImageRepository } from "./token-image-repository.js";

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

const NOT_AN_IMAGE = new TextEncoder().encode("not an image");
const NAMING_REASON = "not named <key>.png, .jpg, .jpeg or .webp";

const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const dirs: string[] = [];
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh library directory holding the given files, and a database file beside it. */
function setup(files: Record<string, Uint8Array>) {
  const root = mkdtempSync(join(tmpdir(), "ttrpg-token-art-import-"));
  dirs.push(root);
  const library = join(root, "library");
  mkdirSync(library);
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(library, name), bytes);
  const dbPath = join(root, "x.db");
  const db = openDatabase(dbPath);
  dbs.push(db);
  return {
    library,
    dbPath,
    db,
    art: new SqliteTokenArtRepository(db),
    images: new SqliteTokenImageRepository(db),
  };
}

function imageCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM token_art_image").get() as {
    n: number;
  };
  return row.n;
}

function snapshot(db: DatabaseSync) {
  return {
    art: db.prepare("SELECT * FROM token_art ORDER BY monster_key").all(),
    images: db
      .prepare("SELECT sha256 FROM token_art_image ORDER BY sha256")
      .all(),
  };
}

describe("importTokenArtLibrary", () => {
  it("stores each valid image of the directory and assigns it to its file's key as art without a url", () => {
    const { library, db, art, images } = setup({
      "srd-2024_goblin.png": PNG_1X1,
      "srd-2024_orc.jpg": JPEG_1X1,
      "srd-2024_wolf.webp": WEBP_1X1,
    });

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary).toEqual({
      stored: [
        { file: "srd-2024_goblin.png", monsterKey: "srd-2024_goblin" },
        { file: "srd-2024_orc.jpg", monsterKey: "srd-2024_orc" },
        { file: "srd-2024_wolf.webp", monsterKey: "srd-2024_wolf" },
      ],
      skipped: [],
      rejected: [],
    });
    expect(art.listTokenArt()).toEqual({
      "srd-2024_goblin": { sha256: sha256Of(PNG_1X1) },
      "srd-2024_orc": { sha256: sha256Of(JPEG_1X1) },
      "srd-2024_wolf": { sha256: sha256Of(WEBP_1X1) },
    });
    expect(images.getTokenImage(sha256Of(PNG_1X1))).toMatchObject({
      mime: "image/png",
      width: 1,
      height: 1,
    });
    expect(images.getTokenImage(sha256Of(JPEG_1X1))?.mime).toBe("image/jpeg");
    expect(images.getTokenImage(sha256Of(WEBP_1X1))?.mime).toBe("image/webp");
  });

  it("accepts the png, jpg, jpeg and webp extensions in any letter case", () => {
    const { library, db, art } = setup({
      "Goblin.PNG": PNG_1X1,
      "orc.Jpg": JPEG_1X1,
      "troll.JPEG": JPEG_1X1,
      "wolf.WebP": WEBP_1X1,
    });

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary.rejected).toEqual([]);
    expect(summary.stored).toEqual([
      { file: "Goblin.PNG", monsterKey: "Goblin" },
      { file: "orc.Jpg", monsterKey: "orc" },
      { file: "troll.JPEG", monsterKey: "troll" },
      { file: "wolf.WebP", monsterKey: "wolf" },
    ]);
    expect(art.listTokenArt()).toEqual({
      Goblin: { sha256: sha256Of(PNG_1X1) },
      orc: { sha256: sha256Of(JPEG_1X1) },
      troll: { sha256: sha256Of(JPEG_1X1) },
      wolf: { sha256: sha256Of(WEBP_1X1) },
    });
  });

  it("a second run over the same directory skips every file and changes nothing", () => {
    const { library, db } = setup({
      "goblin.png": PNG_1X1,
      "wolf.webp": WEBP_1X1,
    });
    importTokenArtLibrary(db, library, { replace: false });
    const before = snapshot(db);

    const again = importTokenArtLibrary(db, library, { replace: false });
    expect(again).toEqual({
      stored: [],
      skipped: [
        { file: "goblin.png", monsterKey: "goblin", reason: "already has art" },
        { file: "wolf.webp", monsterKey: "wolf", reason: "already has art" },
      ],
      rejected: [],
    });
    expect(snapshot(db)).toEqual(before);

    const replacing = importTokenArtLibrary(db, library, { replace: true });
    expect(replacing).toEqual({
      stored: [],
      skipped: [
        {
          file: "goblin.png",
          monsterKey: "goblin",
          reason: "already has this image",
        },
        {
          file: "wolf.webp",
          monsterKey: "wolf",
          reason: "already has this image",
        },
      ],
      rejected: [],
    });
    expect(snapshot(db)).toEqual(before);
  });

  it("a file whose bytes fail validation is rejected with the engine's message and the other files are still imported", () => {
    const { library, db, art } = setup({
      "bad.png": NOT_AN_IMAGE,
      "goblin.png": PNG_1X1,
    });
    const validation = validateTokenImage(NOT_AN_IMAGE);
    if (validation.ok) throw new Error("expected the bytes to fail validation");

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary).toEqual({
      stored: [{ file: "goblin.png", monsterKey: "goblin" }],
      skipped: [],
      rejected: [{ file: "bad.png", reason: validation.message }],
    });
    expect(art.listTokenArt()).toEqual({
      goblin: { sha256: sha256Of(PNG_1X1) },
    });
    expect(imageCount(db)).toBe(1);
  });

  it("a file not named <key>.png, .jpg, .jpeg or .webp is rejected and nothing is stored for it", () => {
    const { library, db, art } = setup({
      "goblin.gif": PNG_1X1,
      "notes.txt": NOT_AN_IMAGE,
      README: NOT_AN_IMAGE,
      "wolf.png.bak": PNG_1X1,
    });

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary).toEqual({
      stored: [],
      skipped: [],
      rejected: [
        { file: "README", reason: NAMING_REASON },
        { file: "goblin.gif", reason: NAMING_REASON },
        { file: "notes.txt", reason: NAMING_REASON },
        { file: "wolf.png.bak", reason: NAMING_REASON },
      ],
    });
    expect(art.listTokenArt()).toEqual({});
    expect(imageCount(db)).toBe(0);
  });

  it("hidden files and subdirectories are ignored", () => {
    const { library, db, art } = setup({
      ".DS_Store": NOT_AN_IMAGE,
      ".orc.png": JPEG_1X1,
      "goblin.png": PNG_1X1,
    });
    mkdirSync(join(library, "troll.png"));
    mkdirSync(join(library, "nested"));
    writeFileSync(join(library, "nested", "wolf.png"), WEBP_1X1);

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary).toEqual({
      stored: [{ file: "goblin.png", monsterKey: "goblin" }],
      skipped: [],
      rejected: [],
    });
    expect(art.listTokenArt()).toEqual({
      goblin: { sha256: sha256Of(PNG_1X1) },
    });
  });

  it("two files for the same key are both rejected and the key gets no art", () => {
    const goblinPng = pngDeclaring(2, 2);
    const { library, db, art, images } = setup({
      "goblin.png": goblinPng,
      "goblin.webp": WEBP_1X1,
      "wolf.png": PNG_1X1,
    });

    const summary = importTokenArtLibrary(db, library, { replace: true });

    const reason = "several files for key goblin: goblin.png, goblin.webp";
    expect(summary).toEqual({
      stored: [{ file: "wolf.png", monsterKey: "wolf" }],
      skipped: [],
      rejected: [
        { file: "goblin.png", reason },
        { file: "goblin.webp", reason },
      ],
    });
    expect(art.listTokenArt()).toEqual({
      wolf: { sha256: sha256Of(PNG_1X1) },
    });
    expect(images.getTokenImage(sha256Of(goblinPng))).toBeUndefined();
    expect(images.getTokenImage(sha256Of(WEBP_1X1))).toBeUndefined();
  });

  it("a key that is not an SRD monster key is imported like any other", () => {
    const { library, db, art } = setup({
      "my-homebrew_ogre-chief.png": PNG_1X1,
    });

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(summary.stored).toEqual([
      {
        file: "my-homebrew_ogre-chief.png",
        monsterKey: "my-homebrew_ogre-chief",
      },
    ]);
    expect(art.listTokenArt()).toEqual({
      "my-homebrew_ogre-chief": { sha256: sha256Of(PNG_1X1) },
    });
  });

  it("imports while another connection holds a read transaction on the database, which then sees the art", () => {
    const { library, dbPath, db } = setup({ "goblin.png": PNG_1X1 });
    const reader = openDatabase(dbPath);
    dbs.push(reader);
    reader.exec("BEGIN");
    reader.prepare("SELECT * FROM token_art").all();

    const summary = importTokenArtLibrary(db, library, { replace: false });
    reader.exec("COMMIT");

    expect(summary.stored).toEqual([
      { file: "goblin.png", monsterKey: "goblin" },
    ]);
    expect(new SqliteTokenArtRepository(reader).listTokenArt()).toEqual({
      goblin: { sha256: sha256Of(PNG_1X1) },
    });
  });

  it("the formatted summary lists each file under stored, skipped or rejected with its reason, then the counts", () => {
    const { library, db, art } = setup({
      "bad.png": NOT_AN_IMAGE,
      "goblin.png": PNG_1X1,
      "orc.webp": WEBP_1X1,
      "wolf.png": pngDeclaring(4, 4),
      "zz.gif": PNG_1X1,
    });
    art.setTokenArt("wolf", {
      url: "https://cdn.owlbear.rodeo/assets/wolf.png",
      mime: "image/png",
      width: 300,
      height: 280,
    });

    const summary = importTokenArtLibrary(db, library, { replace: false });

    expect(formatTokenArtImportSummary(summary).trimEnd()).toBe(
      [
        "stored   goblin.png -> goblin",
        "stored   orc.webp -> orc",
        "skipped  wolf.png -> wolf: already has art",
        "rejected bad.png: Unsupported image type. Use PNG, JPEG or WebP.",
        `rejected zz.gif: ${NAMING_REASON}`,
        "Stored 2, skipped 1, rejected 2.",
      ].join("\n"),
    );
  });
});
