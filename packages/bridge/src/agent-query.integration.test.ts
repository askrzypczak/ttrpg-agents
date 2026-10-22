import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

// Real bridge on an ephemeral port; a `ws` client stands in for the extension.
const AGENT_TOKEN = "a9".repeat(32);
const MANIFEST = { name: "t", action: { popover: "/index.html" } };
const SCENE_STATUS = { name: "scene-status" } as const;

let dir: string;
let server: BridgeServer;
const sockets: WebSocket[] = [];

async function start(queryTimeoutMs?: number): Promise<void> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    ...(queryTimeoutMs !== undefined ? { queryTimeoutMs } : {}),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-agent-"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(MANIFEST));
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

/** A connected, authenticated stand-in extension that records what it receives. */
async function extension(): Promise<{
  ws: WebSocket;
  received: BridgeMessage[];
  nextQuery: () => Promise<BridgeMessage>;
}> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
  sockets.push(ws);
  const received: BridgeMessage[] = [];
  const waiters: ((m: BridgeMessage) => void)[] = [];
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (!r.ok) return;
    received.push(r.message);
    if (r.message.type === "query") waiters.shift()?.(r.message);
  });
  const acked = new Promise<void>((resolve) => {
    const onAck = (data: unknown) => {
      const r = decodeMessage(String(data));
      if (r.ok && r.message.type === "hello-ack") {
        ws.off("message", onAck);
        resolve();
      }
    };
    ws.on("message", onAck);
  });
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: server.token },
    }),
  );
  await acked;
  const nextQuery = () =>
    new Promise<BridgeMessage>((resolve) => waiters.push(resolve));
  return { ws, received, nextQuery };
}

function post(
  body: string,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  return fetch(`http://127.0.0.1:${server.port}/agent/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  }).then(async (res) => {
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // keep the raw text
    }
    return { status: res.status, json };
  });
}

/** The query the client received, failing fast if the HTTP call ends first. */
function queryBefore(
  query: Promise<BridgeMessage>,
  pending: Promise<{ status: number; json: unknown }>,
): Promise<BridgeMessage> {
  return Promise.race([
    query,
    pending.then((res) => {
      throw new Error(
        `the call ended (${String(res.status)}) before a query reached the client`,
      );
    }),
  ]);
}

const sceneStatusResult = (tokenCount: number) => ({
  name: "scene-status" as const,
  result: { sceneReady: true, tokenCount, appliedInstanceCount: tokenCount },
});

function reply(ws: WebSocket, id: string | undefined, tokenCount: number) {
  ws.send(
    encodeMessage({
      v: 1,
      type: "query-result",
      ...(id !== undefined ? { id } : {}),
      payload: sceneStatusResult(tokenCount),
    }),
  );
}

describe("POST /agent/query", () => {
  it("POST with no token -> 401", async () => {
    await start();
    const res = await post(JSON.stringify(SCENE_STATUS));
    expect(res.status).toBe(401);
  });

  it("POST with the extension (bridge) token -> 401", async () => {
    await start();
    const res = await post(JSON.stringify(SCENE_STATUS), server.token);
    expect(res.status).toBe(401);
  });

  it("POST with the agent token reaches the connected client as a `query` with an id, and the client's `query-result` is the HTTP body", async () => {
    await start();
    const ext = await extension();
    const query = ext.nextQuery();
    const pending = post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN);
    const sent = await queryBefore(query, pending);
    if (sent.type !== "query") throw new Error("expected a query");
    expect(sent.payload).toEqual(SCENE_STATUS);
    expect(typeof sent.id).toBe("string");
    expect(sent.id).not.toBe("");
    reply(ext.ws, sent.id, 4);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, result: sceneStatusResult(4) });
  });

  it("a `query-result` with a different id does not complete the call", async () => {
    await start(2000);
    const ext = await extension();
    const query = ext.nextQuery();
    const pending = post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN);
    const sent = await queryBefore(query, pending);
    if (sent.type !== "query" || sent.id === undefined)
      throw new Error("expected a query with an id");
    reply(ext.ws, `${sent.id}-other`, 99);
    reply(ext.ws, undefined, 98);
    await new Promise((resolve) => setTimeout(resolve, 100));
    reply(ext.ws, sent.id, 1);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, result: sceneStatusResult(1) });
  });

  it("a client `error` carrying the query's id -> 502 `query-failed`", async () => {
    await start();
    const ext = await extension();
    const query = ext.nextQuery();
    const pending = post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN);
    const sent = await queryBefore(query, pending);
    if (sent.type !== "query" || sent.id === undefined)
      throw new Error("expected a query with an id");
    ext.ws.send(
      encodeMessage({
        v: 1,
        type: "error",
        id: sent.id,
        payload: { code: "query-failed", message: "boom", fatal: false },
      }),
    );
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({
      ok: false,
      error: { code: "query-failed" },
    });
  });

  it("a malformed body -> 400 `bad-request`", async () => {
    await start();
    const ext = await extension();
    for (const body of ["{nope", "[]", '{"name":"launch"}', "{}"]) {
      const res = await post(body, AGENT_TOKEN);
      expect(res.status, body).toBe(400);
      expect(res.json, body).toMatchObject({
        ok: false,
        error: { code: "bad-request" },
      });
    }
    expect(ext.received.filter((m) => m.type === "query")).toEqual([]);
  });

  it("no connected client -> 503 `not-connected`", async () => {
    await start();
    const res = await post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN);
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({
      ok: false,
      error: { code: "not-connected" },
    });
  });

  it("no reply within `queryTimeoutMs` -> 504 `timeout`", async () => {
    await start(200);
    const ext = await extension();
    const started = Date.now();
    const res = await post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN);
    expect(res.status).toBe(504);
    expect(res.json).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(ext.received.some((m) => m.type === "query")).toBe(true);
  });

  it("manifest.json requested with no token, with the bridge token and with the agent token never contains the agent token", async () => {
    await start();
    // The agent token is live on this server (no client yet, so 503 not 401).
    expect((await post(JSON.stringify(SCENE_STATUS), AGENT_TOKEN)).status).toBe(
      503,
    );
    const base = `http://127.0.0.1:${server.port}/manifest.json`;
    for (const q of ["", `?token=${server.token}`, `?token=${AGENT_TOKEN}`]) {
      const res = await fetch(base + q);
      expect(res.status, q).toBe(200);
      expect(await res.text(), q).not.toContain(AGENT_TOKEN);
    }
  });
});
