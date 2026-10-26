import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const MANIFEST = { name: "t", action: { popover: "/index.html" } };

const snapshot: BridgeMessage = {
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [], seq: 0 },
};

const rooms: BridgeMessage = {
  v: 1,
  type: "map-rooms",
  payload: {
    itemId: "trollskull",
    rooms: [
      {
        name: "Taproom",
        status: "confirmed",
        polygons: [
          [
            { x: 1625, y: 2375 },
            { x: 2500, y: 2375 },
            { x: 2500, y: 3500 },
            { x: 1625, y: 3500 },
          ],
        ],
      },
    ],
  },
};

let dir: string;
let server: BridgeServer | undefined;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-map-rooms-"));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(MANIFEST));
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server?.close();
  server = undefined;
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function start(mapRooms: () => BridgeMessage): Promise<BridgeServer> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshot,
    mapRooms,
  });
  return server;
}

/** Opens a socket and records every decoded message it receives. */
function connect(
  s: BridgeServer,
): Promise<{ ws: WebSocket; received: BridgeMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, {
      origin: `http://localhost:${s.port}`,
    });
    sockets.push(ws);
    const received: BridgeMessage[] = [];
    ws.on("message", (data) => {
      const r = decodeMessage(data.toString());
      if (r.ok) received.push(r.message);
    });
    ws.once("open", () => resolve({ ws, received }));
    ws.once("error", reject);
  });
}

const hello = (token: string) =>
  encodeMessage({
    v: 1,
    type: "hello",
    payload: { role: "gm", extensionVersion: "0", token },
  });

const ping = encodeMessage({ v: 1, type: "ping", payload: {} });

/** Waits until `done` holds or `ms` pass, whichever is first. */
async function waitFor(done: () => boolean, ms = 1000): Promise<void> {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Lets messages already on the way arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("map-rooms after hello-ack", () => {
  it("the bridge sends map-rooms right after the encounter snapshot that follows hello-ack", async () => {
    const s = await start(() => rooms);
    const { ws, received } = await connect(s);

    ws.send(hello(s.token));
    await waitFor(() => received.length >= 3);
    await settle();

    expect(received.map((m) => m.type)).toEqual([
      "hello-ack",
      "encounter-snapshot",
      "map-rooms",
    ]);
    expect(received[2]).toEqual(rooms);
  });

  it("a throwing mapRooms leaves the hello-ack, the snapshot and the socket working", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await start(() => {
      throw new Error("database is locked");
    });
    const { ws, received } = await connect(s);

    ws.send(hello(s.token));
    await waitFor(() => received.length >= 2);
    await settle();
    expect(received.map((m) => m.type)).toEqual([
      "hello-ack",
      "encounter-snapshot",
    ]);
    expect(logged).toHaveBeenCalled();

    ws.send(ping);
    await waitFor(() => received.some((m) => m.type === "pong"));
    expect(received.map((m) => m.type)).toEqual([
      "hello-ack",
      "encounter-snapshot",
      "pong",
    ]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
