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
} from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

const MANIFEST = { name: "t", action: { popover: "/index.html" } };

let dir: string;
let server: BridgeServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(MANIFEST));
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

function helloWith(token: string, role: "gm" | "player" = "gm"): string {
  return encodeMessage({
    v: 1,
    type: "hello",
    id: "h1",
    payload: { role, extensionVersion: "0", token },
  });
}

const ping = encodeMessage({ v: 1, type: "ping", payload: {} });

/** Sends raw and resolves with the reply plus the close code that follows. */
function requestThenClose(
  ws: WebSocket,
  raw: string,
): Promise<{ reply: BridgeMessage; closeCode: number }> {
  return new Promise((resolve, reject) => {
    let reply: BridgeMessage | undefined;
    ws.once("message", (data) => {
      const r = decodeMessage(data.toString());
      if (r.ok) reply = r.message;
      else reject(new Error(r.detail));
    });
    ws.once("close", (code) => {
      if (reply) resolve({ reply, closeCode: code });
      else reject(new Error("closed without a reply"));
    });
    ws.send(raw);
  });
}

async function authed(role: "gm" | "player" = "gm"): Promise<WebSocket> {
  const ws = await connect();
  const reply = await request(ws, helloWith(server.token, role));
  expect(reply.type).toBe("hello-ack");
  return ws;
}

function hostGet(
  port: number,
  path: string,
  hostHeader: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(
      { host: "127.0.0.1", port, path, headers: { Host: hostHeader } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    ).on("error", reject);
  });
}

describe("bridge server", () => {
  it("answers hello with a valid token with hello-ack", async () => {
    const ws = await connect();
    const reply = await request(ws, helloWith(server.token));
    expect(reply.type).toBe("hello-ack");
    expect(reply.id).toBe("h1");
    ws.close();
  });

  it("rejects a wrong token with an error and closes the socket", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(ws, helloWith("wrong"));
    expect(reply.type).toBe("error");
    if (reply.type === "error") expect(reply.payload.code).toBe("bad-token");
    expect(closeCode).toBe(1008);
  });

  it("rejects an empty token", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(ws, helloWith(""));
    expect(reply.type).toBe("error");
    expect(closeCode).toBe(1008);
  });

  it("rejects a hello with no token field", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(
      ws,
      '{"v":1,"type":"hello","payload":{"role":"gm","extensionVersion":"0"}}',
    );
    expect(reply.type).toBe("error");
    expect(closeCode).toBe(1008);
  });

  it("rejects messages sent before hello and closes", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(ws, ping);
    expect(reply.type).toBe("error");
    if (reply.type === "error")
      expect(reply.payload.code).toBe("unauthenticated");
    expect(closeCode).toBe(1008);
  });

  it("rejects malformed messages before hello and closes", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(ws, "{nope");
    expect(reply.type).toBe("error");
    expect(closeCode).toBe(1008);
  });

  it("a version mismatch before hello gets a fatal unsupported-version error and the socket closes", async () => {
    const ws = await connect();
    const { reply, closeCode } = await requestThenClose(
      ws,
      JSON.stringify({
        v: 9,
        type: "hello",
        payload: { role: "gm", extensionVersion: "0", token: server.token },
      }),
    );
    if (reply.type !== "error") throw new Error("expected error");
    expect(reply.payload.code).toBe("unsupported-version");
    expect(reply.payload.fatal).toBe(true);
    expect(closeCode).toBe(1008);
  });

  it("bad-token and unauthenticated errors carry fatal true", async () => {
    const badToken = await requestThenClose(await connect(), helloWith("x"));
    if (badToken.reply.type !== "error") throw new Error("expected error");
    expect(badToken.reply.payload.code).toBe("bad-token");
    expect(badToken.reply.payload.fatal).toBe(true);
    const unauth = await requestThenClose(await connect(), ping);
    if (unauth.reply.type !== "error") throw new Error("expected error");
    expect(unauth.reply.payload.code).toBe("unauthenticated");
    expect(unauth.reply.payload.fatal).toBe(true);
  });

  it("treats gm and player roles identically", async () => {
    for (const role of ["gm", "player"] as const) {
      const ok = await authed(role);
      expect((await request(ok, ping)).type).toBe("pong");
      ok.close();
      const bad = await connect();
      const { reply } = await requestThenClose(bad, helloWith("wrong", role));
      expect(reply.type).toBe("error");
    }
  });

  it("answers ping with pong after hello", async () => {
    const ws = await authed();
    const reply = await request(ws, ping);
    expect(reply.type).toBe("pong");
    ws.close();
  });

  it("re-acks a second hello on an authenticated socket", async () => {
    const ws = await authed();
    const reply = await request(ws, helloWith(server.token));
    expect(reply.type).toBe("hello-ack");
    ws.close();
  });

  it("answers malformed messages with an error", async () => {
    const ws = await authed();
    const reply = await request(ws, "{nope");
    expect(reply.type).toBe("error");
    if (reply.type === "error")
      expect(reply.payload.code).toBe("malformed-json");
    expect((await request(ws, ping)).type).toBe("pong");
    ws.close();
  });

  it("a different-version message after login gets fatal unsupported-version and the socket closes", async () => {
    const ws = await authed();
    const closed = new Promise<number>((resolve) =>
      ws.once("close", (code) => resolve(code)),
    );
    const reply = await request(ws, '{"v":9,"type":"ping","payload":{}}');
    if (reply.type !== "error") throw new Error("expected error");
    expect(reply.payload.code).toBe("unsupported-version");
    expect(reply.payload.fatal).toBe(true);
    expect(await closed).toBe(1008);
  });

  it("serves the manifest with CORS for owlbear.rodeo", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/manifest.json`, {
      headers: { Origin: "https://www.owlbear.rodeo" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.owlbear.rodeo",
    );
    expect(await res.json()).toEqual(MANIFEST);
  });

  it("adds the token fragment to the popover only when the token is presented", async () => {
    const base = `http://127.0.0.1:${server.port}/manifest.json`;
    const withToken = await (
      await fetch(`${base}?token=${server.token}`)
    ).json();
    expect(withToken).toEqual({
      ...MANIFEST,
      action: { popover: `/index.html#${server.token}` },
    });
    for (const q of ["?token=wrong", "?token=", ""]) {
      const res = await fetch(base + q);
      expect(await res.json()).toEqual(MANIFEST);
    }
  });

  it("refuses HTTP requests with a foreign Host header", async () => {
    const bad = await hostGet(server.port, "/manifest.json", "evil.example");
    expect(bad.status).toBe(403);
    expect(bad.body).not.toContain("popover");
    const wrongPort = await hostGet(
      server.port,
      "/manifest.json",
      `localhost:${server.port + 1}`,
    );
    expect(wrongPort.status).toBe(403);
    for (const h of [`127.0.0.1:${server.port}`, `localhost:${server.port}`]) {
      expect((await hostGet(server.port, "/manifest.json", h)).status).toBe(
        200,
      );
    }
  });

  it("refuses WebSocket upgrades with a foreign Host header", async () => {
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        origin: `http://localhost:${server.port}`,
        headers: { Host: "evil.example" },
      });
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
    });
    expect(result).toBe("refused");
    expect(server.clientCount()).toBe(0);
  });

  it("accepts WebSocket upgrades addressed to localhost", async () => {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://localhost:${server.port}/ws`, {
        origin: `http://localhost:${server.port}`,
      });
      s.once("open", () => resolve(s));
      s.once("error", reject);
    });
    expect((await request(ws, helloWith(server.token))).type).toBe("hello-ack");
    ws.close();
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

  it("sets CSP and nosniff on static, 404 and OPTIONS responses", async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const responses = [
      await fetch(`${base}/manifest.json`),
      await fetch(`${base}/missing.js`),
      await fetch(`${base}/manifest.json`, { method: "OPTIONS" }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 404, 204]);
    for (const res of responses) {
      expect(res.headers.get("content-security-policy")).toBe(
        "frame-ancestors https://www.owlbear.rodeo https://owlbear.rodeo",
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
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

describe("bridge server broadcast and snapshot", () => {
  const snapshot: BridgeMessage = {
    v: 1,
    type: "encounter-snapshot",
    payload: { instances: [] },
  };
  const cleared: BridgeMessage = {
    v: 1,
    type: "encounter-event",
    payload: { type: "cleared" },
  };

  /** Records every decoded message a socket receives, from now on. */
  function record(ws: WebSocket): BridgeMessage[] {
    const received: BridgeMessage[] = [];
    ws.on("message", (data) => {
      const r = decodeMessage(data.toString());
      if (r.ok) received.push(r.message);
    });
    return received;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  let s2: BridgeServer;
  beforeEach(async () => {
    s2 = await startBridgeServer({
      port: 0,
      staticDir: dir,
      snapshot: () => snapshot,
    });
  });
  afterEach(async () => {
    await s2.close();
  });

  function connect2(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s2.port}/ws`, {
        origin: `http://localhost:${s2.port}`,
      });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  const hello2 = () =>
    encodeMessage({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: s2.token },
    });

  /** Connects, records every message and the close code, sends hello and settles. */
  async function authed2(): Promise<{
    ws: WebSocket;
    msgs: BridgeMessage[];
    closed: { code: number | undefined };
  }> {
    const ws = await connect2();
    const msgs = record(ws);
    const closed: { code: number | undefined } = { code: undefined };
    ws.on("close", (code) => (closed.code = code));
    ws.send(hello2());
    await settle();
    return { ws, msgs, closed };
  }

  it("sends the snapshot right after hello-ack", async () => {
    const ws = await connect2();
    const received = record(ws);
    ws.send(hello2());
    await settle();
    expect(received.map((m) => m.type)).toEqual([
      "hello-ack",
      "encounter-snapshot",
    ]);
    ws.close();
  });

  it("broadcasts to authenticated clients only", async () => {
    const authedWs = await connect2();
    const authedMsgs = record(authedWs);
    authedWs.send(hello2());
    const anon = await connect2();
    const anonMsgs = record(anon);
    await settle();
    authedMsgs.length = 0;
    s2.broadcast(cleared);
    await settle();
    expect(authedMsgs).toEqual([cleared]);
    expect(anonMsgs).toEqual([]);
    authedWs.close();
    anon.close();
  });

  it("reports snapshot-failed and stays up when the snapshot throws", async () => {
    const s3 = await startBridgeServer({
      port: 0,
      staticDir: dir,
      snapshot: () => {
        throw new Error("db locked");
      },
    });
    try {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${s3.port}/ws`, {
          origin: `http://localhost:${s3.port}`,
        });
        w.once("open", () => resolve(w));
        w.once("error", reject);
      });
      const received = record(ws);
      ws.send(
        encodeMessage({
          v: 1,
          type: "hello",
          payload: { role: "gm", extensionVersion: "0", token: s3.token },
        }),
      );
      await settle();
      expect(received.map((m) => m.type)).toEqual(["hello-ack", "error"]);
      const err = received[1];
      if (err?.type === "error") {
        expect(err.payload).toEqual({
          code: "snapshot-failed",
          message: "db locked",
          fatal: false,
        });
      }
      received.length = 0;
      ws.send(ping);
      await settle();
      expect(received.map((m) => m.type)).toEqual(["pong"]);
      ws.close();
    } finally {
      await s3.close();
    }
  });

  it("malformed, unexpected-type and snapshot-failed errors carry fatal false and the socket stays usable", async () => {
    const s3 = await startBridgeServer({
      port: 0,
      staticDir: dir,
      snapshot: () => {
        throw new Error("db locked");
      },
    });
    try {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${s3.port}/ws`, {
          origin: `http://localhost:${s3.port}`,
        });
        w.once("open", () => resolve(w));
        w.once("error", reject);
      });
      const received = record(ws);
      let closed = false;
      ws.once("close", () => (closed = true));
      ws.send(
        encodeMessage({
          v: 1,
          type: "hello",
          payload: { role: "gm", extensionVersion: "0", token: s3.token },
        }),
      );
      for (const raw of [
        "{nope",
        "[]",
        '{"v":1,"type":"launch","payload":{}}',
        '{"v":1,"type":"hello","payload":{}}',
        encodeMessage(cleared),
      ]) {
        ws.send(raw);
      }
      await settle();
      const errors = received.flatMap((m) =>
        m.type === "error"
          ? [{ code: m.payload.code, fatal: m.payload.fatal }]
          : [],
      );
      expect(errors).toEqual([
        { code: "snapshot-failed", fatal: false },
        { code: "malformed-json", fatal: false },
        { code: "malformed-envelope", fatal: false },
        { code: "unknown-type", fatal: false },
        { code: "invalid-payload", fatal: false },
        { code: "unexpected-type", fatal: false },
      ]);
      received.length = 0;
      ws.send(ping);
      await settle();
      expect(received.map((m) => m.type)).toEqual(["pong"]);
      expect(closed).toBe(false);
      ws.close();
    } finally {
      await s3.close();
    }
  });

  it("a client-sent encounter-event gets a non-fatal unexpected-type error and the socket stays usable", async () => {
    const { ws, msgs, closed } = await authed2();
    msgs.length = 0;
    ws.send(encodeMessage(cleared));
    await settle();
    expect(msgs).toHaveLength(1);
    const reply = msgs[0];
    if (reply?.type !== "error") throw new Error("expected error");
    expect(reply.payload.code).toBe("unexpected-type");
    expect(reply.payload.fatal).toBe(false);
    msgs.length = 0;
    ws.send(ping);
    await settle();
    expect(msgs.map((m) => m.type)).toEqual(["pong"]);
    expect(closed.code).toBeUndefined();
    ws.close();
  });

  it("a second authenticated client supersedes the first with a fatal superseded error and close 1008", async () => {
    const first = await authed2();
    first.msgs.length = 0;
    const second = await authed2();
    const errors = first.msgs.flatMap((m) =>
      m.type === "error"
        ? [{ code: m.payload.code, fatal: m.payload.fatal }]
        : [],
    );
    expect(errors).toEqual([{ code: "superseded", fatal: true }]);
    expect(first.closed.code).toBe(1008);
    expect(second.closed.code).toBeUndefined();
    second.ws.close();
  });

  it("after a supersede, broadcast and the snapshot reach only the new client", async () => {
    const first = await authed2();
    first.msgs.length = 0;
    const second = await authed2();
    expect(second.msgs.map((m) => m.type)).toEqual([
      "hello-ack",
      "encounter-snapshot",
    ]);
    expect(first.msgs.map((m) => m.type)).not.toContain("encounter-snapshot");
    first.msgs.length = 0;
    second.msgs.length = 0;
    s2.broadcast(cleared);
    await settle();
    expect(second.msgs).toEqual([cleared]);
    expect(first.msgs).toEqual([]);
    expect(first.closed.code).toBe(1008);
    second.ws.close();
  });

  it("a bad-token hello does not displace the active client", async () => {
    const active = await authed2();
    active.msgs.length = 0;
    const { reply } = await requestThenClose(
      await connect2(),
      helloWith("wrong"),
    );
    if (reply.type !== "error") throw new Error("expected error");
    expect(reply.payload.code).toBe("bad-token");
    await settle();
    expect(active.msgs).toEqual([]);
    expect(active.closed.code).toBeUndefined();
    s2.broadcast(cleared);
    await settle();
    expect(active.msgs).toEqual([cleared]);
    active.ws.close();
  });

  it("a socket rejected as unauthenticated (ping before hello) does not displace the active client", async () => {
    const active = await authed2();
    active.msgs.length = 0;
    const { reply } = await requestThenClose(await connect2(), ping);
    if (reply.type !== "error") throw new Error("expected error");
    expect(reply.payload.code).toBe("unauthenticated");
    await settle();
    expect(active.msgs).toEqual([]);
    expect(active.closed.code).toBeUndefined();
    s2.broadcast(cleared);
    await settle();
    expect(active.msgs).toEqual([cleared]);
    active.ws.close();
  });

  it("a late close of the superseded socket does not clear the new active client", async () => {
    const first = await authed2();
    const second = await authed2();
    await settle();
    // The superseded socket has closed, so the server has run its close handling.
    expect(first.closed.code).toBe(1008);
    second.msgs.length = 0;
    s2.broadcast(cleared);
    await settle();
    expect(second.msgs).toEqual([cleared]);
    second.ws.close();
  });

  it("stops broadcasting to a client that disconnected", async () => {
    const ws = await connect2();
    ws.send(hello2());
    await settle();
    ws.close();
    await settle();
    expect(() => s2.broadcast(cleared)).not.toThrow();
  });

  it("a repeated hello on the active socket does not supersede it", async () => {
    const { ws, msgs, closed } = await authed2();
    msgs.length = 0;
    ws.send(hello2());
    await settle();
    expect(msgs.map((m) => m.type)).toContain("hello-ack");
    expect(msgs.map((m) => m.type)).not.toContain("error");
    expect(closed.code).toBeUndefined();
    msgs.length = 0;
    s2.broadcast(cleared);
    await settle();
    expect(msgs).toEqual([cleared]);
    ws.close();
  });
});
