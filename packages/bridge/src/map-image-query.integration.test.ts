import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

// Real bridge on an ephemeral port; a `ws` client stands in for the extension.
const AGENT_TOKEN = "b7".repeat(32);
const MANIFEST = { name: "t", action: { popover: "/index.html" } };
const MAP_IMAGE = { name: "map-image", itemId: "map-1" } as const;
const IMAGE = {
  mimeType: "image/webp" as const,
  data: "UklGRg==",
  width: 1598,
  height: 1222,
};

let dir: string;
let server: BridgeServer | undefined;
const sockets: WebSocket[] = [];

async function start(timeouts: {
  queryTimeoutMs: number;
  mapImageTimeoutMs: number;
}): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
    ...timeouts,
  });
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-map-image-"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(MANIFEST));
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await server?.close();
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** A connected, authenticated stand-in extension. */
async function extension(bridge: BridgeServer): Promise<{
  ws: WebSocket;
  nextQuery: () => Promise<BridgeMessage>;
}> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, {
      origin: `http://localhost:${bridge.port}`,
    });
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
  sockets.push(ws);
  const waiters: ((m: BridgeMessage) => void)[] = [];
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (r.ok && r.message.type === "query") waiters.shift()?.(r.message);
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
      payload: { role: "gm", extensionVersion: "0", token: bridge.token },
    }),
  );
  await acked;
  return {
    ws,
    nextQuery: () =>
      new Promise<BridgeMessage>((resolve) => waiters.push(resolve)),
  };
}

function post(
  bridge: BridgeServer,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return fetch(`http://127.0.0.1:${bridge.port}/agent/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: JSON.stringify(body),
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
        `the call ended (${String(res.status)}: ${JSON.stringify(res.json)}) before a query reached the client`,
      );
    }),
  ]);
}

describe("POST /agent/query map-image", () => {
  it("a `map-image` reply that comes after `queryTimeoutMs` but within `mapImageTimeoutMs` is the HTTP body", async () => {
    const bridge = await start({
      queryTimeoutMs: 100,
      mapImageTimeoutMs: 5000,
    });
    const { ws, nextQuery } = await extension(bridge);
    const pending = post(bridge, MAP_IMAGE);
    const query = await queryBefore(nextQuery(), pending);
    expect(query.payload).toEqual(MAP_IMAGE);

    await delay(400);
    ws.send(
      encodeMessage({
        v: 1,
        type: "query-result",
        ...(query.id !== undefined ? { id: query.id } : {}),
        payload: { name: "map-image", result: IMAGE },
      }),
    );

    expect(await pending).toEqual({
      status: 200,
      json: { ok: true, result: { name: "map-image", result: IMAGE } },
    });
  });

  it("no `map-image` reply within `mapImageTimeoutMs` -> 504 `timeout`", async () => {
    const bridge = await start({ queryTimeoutMs: 100, mapImageTimeoutMs: 700 });
    const { nextQuery } = await extension(bridge);
    const started = Date.now();
    const pending = post(bridge, MAP_IMAGE);
    await queryBefore(nextQuery(), pending);

    const res = await pending;
    const elapsed = Date.now() - started;

    expect(res).toEqual({
      status: 504,
      json: {
        ok: false,
        error: {
          code: "timeout",
          message: expect.stringContaining("700") as unknown,
        },
      },
    });
    // Timers may fire a little early on some platforms.
    expect(elapsed).toBeGreaterThanOrEqual(650);
  });
});
