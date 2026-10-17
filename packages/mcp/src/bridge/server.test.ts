import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/core/bridge";
import { startBridgeServer, type BridgeServer } from "./server.js";

let dir: string;
let server: BridgeServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-"));
  await writeFile(join(dir, "manifest.json"), '{"name":"t"}');
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "index.html"), "<p>hi</p>");
  server = await startBridgeServer({ port: 0, staticDir: dir });
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function request(ws: WebSocket, raw: string): Promise<BridgeMessage> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      const r = decodeMessage(data.toString());
      if (r.ok) resolve(r.message);
      else reject(new Error(r.detail));
    });
    ws.send(raw);
  });
}

function rawGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

const hello = encodeMessage({
  v: 1,
  type: "hello",
  id: "h1",
  payload: { role: "gm", extensionVersion: "0" },
});

describe("bridge server", () => {
  it("answers hello with hello-ack", async () => {
    const ws = await connect();
    const reply = await request(ws, hello);
    expect(reply.type).toBe("hello-ack");
    expect(reply.id).toBe("h1");
    ws.close();
  });

  it("answers ping with pong", async () => {
    const ws = await connect();
    const reply = await request(
      ws,
      encodeMessage({ v: 1, type: "ping", payload: {} }),
    );
    expect(reply.type).toBe("pong");
    ws.close();
  });

  it("answers malformed messages with an error", async () => {
    const ws = await connect();
    const reply = await request(ws, "{nope");
    expect(reply.type).toBe("error");
    if (reply.type === "error")
      expect(reply.payload.code).toBe("malformed-json");
    const bad = await request(ws, '{"v":9,"type":"ping","payload":{}}');
    if (bad.type === "error")
      expect(bad.payload.code).toBe("unsupported-version");
    else throw new Error("expected error");
    ws.close();
  });

  it("serves two simultaneous clients", async () => {
    const a = await connect();
    const b = await connect();
    expect(server.clientCount()).toBe(2);
    const [ra, rb] = await Promise.all([request(a, hello), request(b, hello)]);
    expect(ra.type).toBe("hello-ack");
    expect(rb.type).toBe("hello-ack");
    a.close();
    const rb2 = await request(
      b,
      encodeMessage({ v: 1, type: "ping", payload: {} }),
    );
    expect(rb2.type).toBe("pong");
    b.close();
  });

  it("serves the manifest with CORS for owlbear.rodeo", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/manifest.json`, {
      headers: { Origin: "https://www.owlbear.rodeo" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.owlbear.rodeo",
    );
    expect(await res.json()).toEqual({ name: "t" });
  });

  it("does not grant CORS to other origins", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/manifest.json`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves directory indexes, 404s unknown files, blocks traversal", async () => {
    const base = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(`${base}/sub/`)).text()).toBe("<p>hi</p>");
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    await writeFile(join(dir, "..", "bridge-secret.txt"), "secret");
    try {
      for (const p of ["/../bridge-secret.txt", "/..%2fbridge-secret.txt"]) {
        const res = await rawGet(server.port, p);
        expect(res.status).not.toBe(200);
        expect(res.body).not.toContain("secret");
      }
    } finally {
      await rm(join(dir, "..", "bridge-secret.txt"), { force: true });
    }
  });

  it("refuses WebSocket upgrades from foreign origins", async () => {
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        origin: "https://evil.example",
      });
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
    });
    expect(result).toBe("refused");
    expect(server.clientCount()).toBe(0);
  });

  it("refuses WebSocket upgrades without an origin", async () => {
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
    });
    expect(result).toBe("refused");
  });

  it("accepts a staticDir with a trailing slash", async () => {
    const s2 = await startBridgeServer({ port: 0, staticDir: dir + "/" });
    try {
      const res = await fetch(`http://127.0.0.1:${s2.port}/manifest.json`);
      expect(res.status).toBe(200);
    } finally {
      await s2.close();
    }
  });
});
