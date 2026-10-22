import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

// Edge cases of POST /agent/query: body cap, routing, bearer parsing, close
// and timeout cleanup, and replies the bridge cannot match.
const AGENT_TOKEN = "b7".repeat(32);
const SCENE_STATUS = JSON.stringify({ name: "scene-status" });
const MIB = 1024 * 1024;

let dir: string;
let server: BridgeServer | undefined;
const sockets: WebSocket[] = [];

async function start(queryTimeoutMs?: number): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    ...(queryTimeoutMs !== undefined ? { queryTimeoutMs } : {}),
  });
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-agent-extra-"));
  await writeFile(join(dir, "manifest.json"), "{}");
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await server?.close().catch(() => undefined);
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const url = (path = "/agent/query") =>
  `http://127.0.0.1:${String(server?.port)}${path}`;

async function post(
  body: string,
  headers: Record<string, string> = { Authorization: `Bearer ${AGENT_TOKEN}` },
  path?: string,
): Promise<{ status: number; type: string | null; json: unknown }> {
  const res = await fetch(url(path), { method: "POST", headers, body });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep the raw text
  }
  return { status: res.status, type: res.headers.get("content-type"), json };
}

async function extension(): Promise<{
  ws: WebSocket;
  received: BridgeMessage[];
  waitFor: (type: string) => Promise<BridgeMessage>;
}> {
  const s = server as BridgeServer;
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, {
      origin: `http://localhost:${s.port}`,
    });
    w.once("open", () => resolve(w));
    w.once("error", reject);
  });
  sockets.push(ws);
  const received: BridgeMessage[] = [];
  const waiters: { type: string; resolve: (m: BridgeMessage) => void }[] = [];
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (!r.ok) return;
    received.push(r.message);
    for (const w of [...waiters]) {
      if (w.type === r.message.type) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(r.message);
      }
    }
  });
  const waitFor = (type: string) => {
    const seen = received.find((m) => m.type === type);
    if (seen) {
      received.splice(received.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise<BridgeMessage>((resolve) =>
      waiters.push({ type, resolve }),
    );
  };
  const acked = waitFor("hello-ack");
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: s.token },
    }),
  );
  await acked;
  return { ws, received, waitFor };
}

const statusResult = (n: number) => ({
  name: "scene-status" as const,
  result: { sceneReady: true, tokenCount: n, appliedInstanceCount: n },
});

describe("body cap", () => {
  it("a body over 1 MiB with a valid token -> 400 `bad-request`", async () => {
    await start();
    // Valid JSON first, so a bridge that truncated instead of refusing would accept it.
    const res = await post(
      SCENE_STATUS + " ".repeat(MIB + 1 - SCENE_STATUS.length),
    );
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      ok: false,
      error: { code: "bad-request", message: expect.stringMatching(/large/) },
    });
  });

  it("a body of exactly 1 MiB is still parsed", async () => {
    await start();
    // Padding first, so the closing brace is in the last chunk.
    const res = await post(
      " ".repeat(MIB - SCENE_STATUS.length) + SCENE_STATUS,
    );
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ error: { code: "not-connected" } });
  });

  it("a body split across several chunks is read whole", async () => {
    await start();
    const res = await post(SCENE_STATUS + " ".repeat(300_000));
    expect(res.status).toBe(503);
  });

  it("an empty body -> 400 `bad-request`", async () => {
    await start();
    const res = await post("");
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      error: { code: "bad-request", message: expect.stringMatching(/JSON/) },
    });
  });
});

describe("routing and headers", () => {
  it("POST to another path is not the query route", async () => {
    await start();
    const res = await post(SCENE_STATUS, undefined, "/agent/other");
    expect(res.status).toBe(405);
    expect((await post(SCENE_STATUS, undefined, "/")).status).toBe(405);
  });

  it("GET /agent/query is not the query route", async () => {
    await start();
    const res = await fetch(url(), {
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("responses are JSON and carry no CORS headers", async () => {
    await start();
    const unauthorized = await fetch(url(), {
      method: "POST",
      headers: { Origin: "https://www.owlbear.rodeo" },
      body: SCENE_STATUS,
    });
    expect(unauthorized.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await unauthorized.text();
    const ok = await post(SCENE_STATUS);
    expect(ok.type).toBe("application/json; charset=utf-8");
    const cors = await fetch(url(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AGENT_TOKEN}`,
        Origin: "https://www.owlbear.rodeo",
      },
      body: SCENE_STATUS,
    });
    expect(cors.headers.get("access-control-allow-origin")).toBeNull();
    await cors.text();
  });

  it("a wrong Host is still refused on the query route", async () => {
    await start();
    const status = await new Promise<number | undefined>((resolve) => {
      const req = request(
        url(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AGENT_TOKEN}`,
            Host: "evil.example:80",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", () => resolve(undefined));
      req.end(SCENE_STATUS);
    });
    expect(status).toBe(403);
  });

  it.each([
    ["no header", {}],
    ["empty bearer", { Authorization: "Bearer " }],
    ["bare token without scheme", { Authorization: AGENT_TOKEN }],
    ["wrong scheme", { Authorization: `Basic ${AGENT_TOKEN}` }],
    ["wrong token", { Authorization: "Bearer nope" }],
    ["token with a prefix", { Authorization: `Bearer x${AGENT_TOKEN}` }],
  ])("%s -> 401", async (_label, headers) => {
    await start();
    const res = await post(SCENE_STATUS, headers);
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
  });
});

describe("pending queries", () => {
  it("a `query-result` with an unknown id gets a non-fatal `unknown-query-id` error", async () => {
    await start();
    const ext = await extension();
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "query-result",
        id: "nope",
        payload: statusResult(1),
      }),
    );
    const err = await ext.waitFor("error");
    expect(err).toMatchObject({
      type: "error",
      payload: { code: "unknown-query-id", fatal: false },
    });
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "query-result",
        payload: statusResult(1),
      }),
    );
    expect(await ext.waitFor("error")).toMatchObject({
      payload: { code: "unknown-query-id" },
    });
  });

  it("a client `error` with an unknown or no id gets `unexpected-type`", async () => {
    await start();
    const ext = await extension();
    for (const id of ["nope", undefined]) {
      ext.ws.send(
        encodeMessage({
          v: 1,
          type: "error",
          ...(id !== undefined ? { id } : {}),
          payload: { code: "x", message: "m", fatal: false },
        }),
      );
      expect(await ext.waitFor("error")).toMatchObject({
        payload: { code: "unexpected-type", fatal: false },
      });
    }
  });

  it("a client `error` carries its message into the 502 body", async () => {
    await start();
    const ext = await extension();
    const pending = post(SCENE_STATUS);
    const sent = await ext.waitFor("query");
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "error",
        ...(sent.id !== undefined ? { id: sent.id } : {}),
        payload: { code: "query-failed", message: "boom!", fatal: false },
      }),
    );
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.json).toEqual({
      ok: false,
      error: { code: "query-failed", message: "boom!" },
    });
  });

  it("a late `query-result` after the timeout is unknown, and a second query still works", async () => {
    await start(150);
    const ext = await extension();
    const first = await post(SCENE_STATUS);
    expect(first.status).toBe(504);
    const late = await ext.waitFor("query");
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "query-result",
        ...(late.id !== undefined ? { id: late.id } : {}),
        payload: statusResult(1),
      }),
    );
    expect(await ext.waitFor("error")).toMatchObject({
      payload: { code: "unknown-query-id" },
    });

    const second = post(SCENE_STATUS);
    const next = await ext.waitFor("query");
    expect(next.id).not.toBe(late.id);
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "query-result",
        ...(next.id !== undefined ? { id: next.id } : {}),
        payload: statusResult(2),
      }),
    );
    expect((await second).json).toEqual({
      ok: true,
      result: statusResult(2),
    });
  });

  it("a completed query's id is forgotten", async () => {
    await start(5000);
    const ext = await extension();
    const pending = post(SCENE_STATUS);
    const sent = await ext.waitFor("query");
    const reply = encodeMessage({
      v: 1,
      type: "query-result",
      ...(sent.id !== undefined ? { id: sent.id } : {}),
      payload: statusResult(3),
    });
    ext.ws.send(reply);
    await pending;
    ext.ws.send(reply);
    expect(await ext.waitFor("error")).toMatchObject({
      payload: { code: "unknown-query-id" },
    });
  });

  it("with the client gone the query is `not-connected`", async () => {
    const s = await start();
    const ext = await extension();
    ext.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(s.clientCount()).toBe(0);
    const res = await post(SCENE_STATUS);
    expect(res.status).toBe(503);
  });
});
