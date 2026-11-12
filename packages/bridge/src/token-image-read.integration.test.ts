import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storeTokenImage } from "@ttrpg-agents/engine";
import {
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  tokenImagePath,
  tokenImageReadErrorSchema,
} from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

const AGENT_TOKEN = "a9".repeat(32);

const fromBase64 = (b64: string): Uint8Array =>
  new Uint8Array(Buffer.from(b64, "base64"));

const PNG_1X1 = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);
const WEBP_1X1 = fromBase64("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==");

let dir: string;
let db: DatabaseSync;
let images: SqliteTokenImageRepository;
let server: BridgeServer | undefined;

/** A bridge over a temp SQLite file, wired like the CLI, with no extension token. */
async function startBridge(): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    storeTokenImage: (bytes) => storeTokenImage(images, bytes),
    getTokenImage: (sha256) => images.getTokenImage(sha256),
  });
  return server;
}

/** Stores the bytes as a token image and returns their hash. */
function seed(bytes: Uint8Array): string {
  const result = storeTokenImage(images, bytes);
  if (!result.ok) throw new Error(result.message);
  return result.sha256;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-image-read-"));
  db = openDatabase(join(dir, "test.db"));
  images = new SqliteTokenImageRepository(db);
  server = undefined;
});

afterEach(async () => {
  await server?.close();
  if (db.isOpen) db.close();
  await rm(dir, { recursive: true, force: true });
});

interface Answer {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  bytes: Buffer;
}

/** A GET on the bridge with raw control over the path and headers. */
function get(
  bridge: BridgeServer,
  path: string,
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: bridge.port, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** The refusal's code, or undefined when the body is not a typed read refusal. */
function refusalCode(answer: Answer): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(answer.bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  const parsed = tokenImageReadErrorSchema.safeParse(json);
  return parsed.success ? parsed.data.error.code : undefined;
}

describe("GET /token-images/<sha256>", () => {
  it("the read route answers 404 not_found for a hash it does not hold, a malformed hash or a query string", async () => {
    const bridge = await startBridge();
    const sha256 = seed(PNG_1X1);

    for (const path of [
      `/token-images/${"0f".repeat(32)}`,
      `/token-images/${sha256.toUpperCase()}`,
      `/token-images/${sha256.slice(0, 63)}`,
      `/token-images/${sha256}0`,
      `/token-images/${sha256}/`,
      `/token-images/${sha256}?download=1`,
      `/token-images/../${sha256}`,
    ]) {
      const answer = await get(bridge, path);
      expect(answer.status, path).toBe(404);
      expect(refusalCode(answer), path).toBe("not_found");
    }

    // Control: the exact path of the stored hash is answered.
    const found = await get(bridge, `/token-images/${sha256}`);
    expect(found.status).toBe(200);
  });

  it("the read route answers a wrong Host with the plain 403 of the Host check", async () => {
    const bridge = await startBridge();
    const sha256 = seed(PNG_1X1);
    const path = `/token-images/${sha256}`;

    const answer = await get(bridge, path, { Host: "evil.example:80" });
    expect(answer.status).toBe(403);
    expect(answer.headers["content-type"]).toMatch(/^text\/plain/);
    expect(answer.bytes.includes(Buffer.from(PNG_1X1))).toBe(false);

    // Control: the same request with the right Host gets the image.
    const accepted = await get(bridge, path);
    expect(accepted.status).toBe(200);
    expect(accepted.bytes).toEqual(Buffer.from(PNG_1X1));
  });

  it("the read route sends no CORS headers, even for an Owlbear origin", async () => {
    const bridge = await startBridge();
    const sha256 = seed(PNG_1X1);
    const path = `/token-images/${sha256}`;

    for (const origin of [
      "https://www.owlbear.rodeo",
      "https://owlbear.rodeo",
    ]) {
      const answer = await get(bridge, path, { Origin: origin });
      expect(answer.status).toBe(200);
      expect(answer.bytes).toEqual(Buffer.from(PNG_1X1));
      expect(answer.headers["access-control-allow-origin"]).toBeUndefined();
    }

    // Refusals carry none either.
    for (const refusedPath of [
      `/token-images/${"0f".repeat(32)}`,
      `/token-images/${sha256.toUpperCase()}`,
    ]) {
      const refused = await get(bridge, refusedPath, {
        Origin: "https://www.owlbear.rodeo",
      });
      expect(refused.status, refusedPath).toBe(404);
      expect(
        refused.headers["access-control-allow-origin"],
        refusedPath,
      ).toBeUndefined();
    }
  });

  it("GET /token-images/<sha256> answers the stored bytes with the stored mime as Content-Type with no Authorization", async () => {
    const bridge = await startBridge();
    for (const [bytes, mime] of [
      [PNG_1X1, "image/png"],
      [WEBP_1X1, "image/webp"],
    ] as const) {
      const sha256 = seed(bytes);
      const answer = await get(bridge, tokenImagePath(sha256));
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(mime);
      expect(answer.headers["x-content-type-options"]).toBe("nosniff");
      expect(answer.bytes).toEqual(Buffer.from(bytes));
    }
  });
});
