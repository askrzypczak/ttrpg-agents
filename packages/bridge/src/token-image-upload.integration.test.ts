import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TOKEN_IMAGE_MAX_BYTES,
  storeTokenImage,
  type TokenImageStoreResult,
} from "@ttrpg-agents/engine";
import {
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  TOKEN_IMAGE_UPLOAD_PATH,
  tokenImageUploadResponseSchema,
  type TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

const AGENT_TOKEN = "a9".repeat(32);

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

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
);

/** A PNG signature and IHDR declaring the given size, zero-padded to `length` bytes. */
function pngDeclaring(
  width: number,
  height: number,
  length: number,
): Uint8Array {
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

const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

let dir: string;
let db: DatabaseSync;
let images: SqliteTokenImageRepository;
let server: BridgeServer | undefined;
let listener: Server | undefined;

/** A bridge over a temp SQLite file, wired like the CLI unless overridden. */
async function start(
  store: (bytes: Uint8Array) => TokenImageStoreResult = (bytes) =>
    storeTokenImage(images, bytes),
): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    storeTokenImage: store,
  });
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-image-upload-"));
  db = openDatabase(join(dir, "test.db"));
  images = new SqliteTokenImageRepository(db);
  server = undefined;
  listener = undefined;
});

afterEach(async () => {
  await server?.close();
  if (listener !== undefined) {
    const l = listener;
    await new Promise<void>((resolve) => l.close(() => resolve()));
  }
  if (db.isOpen) db.close();
  await rm(dir, { recursive: true, force: true });
});

function storedImageCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM token_art_image").get() as {
    n: number;
  };
  return row.n;
}

interface Answer {
  status: number;
  contentType: string | null;
  /** The parsed upload response, or undefined when the body is not one. */
  body: TokenImageUploadResponse | undefined;
}

function parseAnswer(text: string): TokenImageUploadResponse | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = tokenImageUploadResponseSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** Posts raw bytes to the upload route from the bridge's own origin. */
function upload(bridge: BridgeServer, body: Uint8Array): Promise<Answer> {
  return post(bridge, body, {
    Origin: `http://127.0.0.1:${String(bridge.port)}`,
  });
}

/** The refusal's code, or undefined when the answer is not a typed refusal. */
function refusalCode(answer: Answer): string | undefined {
  return answer.body === undefined || answer.body.ok
    ? undefined
    : answer.body.error.code;
}

describe("POST /token-images", () => {
  it("POST /token-images with a wrong Host is refused with 403 and stores nothing", async () => {
    const bridge = await start();
    const answer = await new Promise<{
      status: number | undefined;
      contentType: string | undefined;
    }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${String(bridge.port)}${TOKEN_IMAGE_UPLOAD_PATH}`,
        {
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${String(bridge.port)}`,
            Host: "evil.example:80",
          },
        },
        (res) => {
          res.resume();
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"],
          });
        },
      );
      req.on("error", reject);
      req.end(PNG_1X1);
    });
    expect(answer.status).toBe(403);
    expect(answer.contentType).toMatch(/^text\/plain/);
    expect(storedImageCount()).toBe(0);
    // Control: the same request with the right Host is accepted.
    expect((await upload(bridge, PNG_1X1)).status).toBe(200);
  });

  it("POST /token-images with a body over 1 MiB is refused with 413 too_large and stores nothing", async () => {
    const bridge = await start();
    const over = pngDeclaring(2048, 1, TOKEN_IMAGE_MAX_BYTES + 1);
    const answer = await upload(bridge, over);
    expect(answer.status).toBe(413);
    expect(refusalCode(answer)).toBe("too_large");
    expect(storedImageCount()).toBe(0);
    // Control: the same image one byte shorter, exactly 1 MiB, is accepted.
    const exact = pngDeclaring(2048, 1, TOKEN_IMAGE_MAX_BYTES);
    const accepted = await upload(bridge, exact);
    expect(accepted.status).toBe(200);
    expect(storedImageCount()).toBe(1);
  });

  it("POST /token-images with an SVG body is refused with 422 svg and stores nothing", async () => {
    const bridge = await start();
    const answer = await upload(bridge, SVG);
    expect(answer.status).toBe(422);
    expect(refusalCode(answer)).toBe("svg");
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images with unknown bytes is refused with 422 unsupported_type and stores nothing", async () => {
    const bridge = await start();
    const unknown = new Uint8Array(64).map((_, i) => (i * 7 + 3) % 251);
    const answer = await upload(bridge, unknown);
    expect(answer.status).toBe(422);
    expect(refusalCode(answer)).toBe("unsupported_type");
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images answers 500 store_failed when the store throws", async () => {
    const bridge = await start(() => {
      throw new Error("database is locked");
    });
    const answer = await upload(bridge, PNG_1X1);
    expect(answer.status).toBe(500);
    expect(refusalCode(answer)).toBe("store_failed");
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images with a body naming a URL requests nothing, is refused and stores nothing", async () => {
    let requests = 0;
    const canary = createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG_1X1);
    });
    listener = canary;
    await new Promise<void>((resolve) =>
      canary.listen(0, "127.0.0.1", () => resolve()),
    );
    const canaryPort = (canary.address() as AddressInfo).port;
    const bridge = await start();

    const body = new TextEncoder().encode(
      `http://127.0.0.1:${String(canaryPort)}/canary.png`,
    );
    const answer = await upload(bridge, body);
    // Grace period for any request the bridge might have started late.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(requests).toBe(0);
    expect(answer.status).toBe(422);
    expect(refusalCode(answer)).toBe("unsupported_type");
    expect(storedImageCount()).toBe(0);
  });
});

/** A bridge over a temp SQLite file, wired like the CLI, with no extension token. */
async function startBridge(): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    storeTokenImage: (bytes) => storeTokenImage(images, bytes),
  });
  return server;
}

/** The two origins the bridge serves its own pages from. */
const ownOrigins = (bridge: BridgeServer): string[] => [
  `http://localhost:${String(bridge.port)}`,
  `http://127.0.0.1:${String(bridge.port)}`,
];

/** Posts raw bytes to the upload route with exactly the given extra headers. */
function post(
  bridge: BridgeServer,
  body: Uint8Array,
  headers: Record<string, string>,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = request(
      {
        host: "127.0.0.1",
        port: bridge.port,
        path: TOKEN_IMAGE_UPLOAD_PATH,
        method: "POST",
        headers: { "Content-Length": String(body.length), ...headers },
      },
      (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: res.headers["content-type"] ?? null,
            body: parseAnswer(Buffer.concat(chunks).toString("utf8")),
          }),
        );
        res.on("error", reject);
      },
    );
    // A refusal sent before the body is read may cut the upload short.
    req.on("error", (e) => {
      if (!answered) reject(e);
    });
    req.end(body);
  });
}

describe("POST /token-images by origin", () => {
  it("POST /token-images with the bridge's own Origin (localhost or 127.0.0.1 with its port) stores a PNG, a JPEG and a WebP and answers each one's hash, mime and dimensions", async () => {
    const bridge = await startBridge();
    const cases = [
      [PNG_1X1, "image/png"],
      [JPEG_1X1, "image/jpeg"],
      [WEBP_1X1, "image/webp"],
    ] as const;
    for (const origin of ownOrigins(bridge)) {
      for (const [bytes, mime] of cases) {
        const answer = await post(bridge, bytes, { Origin: origin });
        const sha256 = sha256Of(bytes);
        expect(answer.status, origin).toBe(200);
        expect(answer.body, origin).toEqual({
          ok: true,
          image: { sha256, mime, width: 1, height: 1 },
        });
        const stored = images.getTokenImage(sha256);
        expect(stored).toMatchObject({ sha256, mime, width: 1, height: 1 });
        expect(Buffer.from(stored?.bytes ?? [])).toEqual(Buffer.from(bytes));
      }
    }
    expect(storedImageCount()).toBe(3);
  });

  it("POST /token-images with another Origin (an Owlbear origin, another port, null) is refused with 403 unauthorized and stores nothing", async () => {
    const bridge = await startBridge();
    for (const origin of [
      "https://www.owlbear.rodeo",
      `http://localhost:${String(bridge.port + 1)}`,
      "null",
    ]) {
      const answer = await post(bridge, PNG_1X1, { Origin: origin });
      expect(answer.status, origin).toBe(403);
      expect(refusalCode(answer), origin).toBe("unauthorized");
    }
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images with no Origin is refused with 403 unauthorized and stores nothing", async () => {
    const bridge = await startBridge();
    const answer = await post(bridge, PNG_1X1, {});
    expect(answer.status).toBe(403);
    expect(refusalCode(answer)).toBe("unauthorized");
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images with another Origin is refused with 403 before reading a body over 1 MiB", async () => {
    const bridge = await startBridge();
    // Read, this body would be refused as too_large instead.
    const over = pngDeclaring(1, 1, TOKEN_IMAGE_MAX_BYTES + 1);
    const answer = await post(bridge, over, {
      Origin: "https://www.owlbear.rodeo",
    });
    expect(answer.status).toBe(403);
    expect(refusalCode(answer)).toBe("unauthorized");
    expect(storedImageCount()).toBe(0);
  });

  it("POST /token-images decides by Origin alone: a bearer (the agent token or any other) neither admits another origin nor stops the bridge's own", async () => {
    const bridge = await startBridge();
    const own = `http://localhost:${String(bridge.port)}`;
    for (const bearer of [AGENT_TOKEN, "not-a-token"]) {
      const refused = await post(bridge, PNG_1X1, {
        Origin: "https://www.owlbear.rodeo",
        Authorization: `Bearer ${bearer}`,
      });
      expect(refused.status, bearer).toBe(403);
      expect(refusalCode(refused), bearer).toBe("unauthorized");
    }
    expect(storedImageCount()).toBe(0);
    for (const bearer of [AGENT_TOKEN, "not-a-token"]) {
      const accepted = await post(bridge, PNG_1X1, {
        Origin: own,
        Authorization: `Bearer ${bearer}`,
      });
      expect(accepted.status, bearer).toBe(200);
    }
    expect(storedImageCount()).toBe(1);
  });
});
