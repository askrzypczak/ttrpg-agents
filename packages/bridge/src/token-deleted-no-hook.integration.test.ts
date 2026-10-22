import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { decodeMessage, type BridgeMessage } from "@ttrpg-agents/protocol";
import { startBridgeServer, type BridgeServer } from "./server.js";

let dir: string;
let server: BridgeServer | undefined;
let ws: WebSocket | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-deleted-no-hook-"));
});

afterEach(async () => {
  ws?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

it("token-deleted without a removeInstance option gets a non-fatal unexpected-type error", async () => {
  server = await startBridgeServer({ port: 0, staticDir: dir });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    origin: `http://localhost:${server.port}`,
  });
  ws = socket;
  const received: BridgeMessage[] = [];
  socket.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (r.ok) received.push(r.message);
  });
  await new Promise((resolve) => socket.once("open", resolve));
  socket.send(
    JSON.stringify({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: server.token },
    }),
  );
  socket.send(
    JSON.stringify({
      v: 1,
      type: "token-deleted",
      id: "token-deleted:i1",
      payload: { instanceId: "i1" },
    }),
  );
  const deadline = Date.now() + 2000;
  while (!received.some((m) => m.type === "error") && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(received.find((m) => m.type === "error")).toMatchObject({
    type: "error",
    payload: { code: "unexpected-type", fatal: false },
  });
  expect(socket.readyState).toBe(socket.OPEN);
});
