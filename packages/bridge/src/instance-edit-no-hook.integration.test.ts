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
  dir = await mkdtemp(join(tmpdir(), "instance-edit-hooks-"));
});

afterEach(async () => {
  ws?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

async function editError(
  editInstance?: () => never,
): Promise<{ error: BridgeMessage | undefined; open: boolean }> {
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    ...(editInstance ? { editInstance } : {}),
  });
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
      type: "instance-edit",
      id: "instance-edit:i1",
      payload: { instanceId: "i1", currentHp: 3 },
    }),
  );
  const deadline = Date.now() + 2000;
  while (!received.some((m) => m.type === "error") && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    error: received.find((m) => m.type === "error"),
    open: socket.readyState === socket.OPEN,
  };
}

it("instance-edit without an editInstance option gets a non-fatal unexpected-type error", async () => {
  const { error, open } = await editError();
  expect(error).toMatchObject({
    type: "error",
    payload: { code: "unexpected-type", fatal: false },
  });
  expect(open).toBe(true);
});

it("a throwing editInstance hook gets a non-fatal edit-failed error with the request id", async () => {
  const { error, open } = await editError(() => {
    throw new Error("database is locked");
  });
  expect(error).toMatchObject({
    type: "error",
    id: "instance-edit:i1",
    payload: { code: "edit-failed", fatal: false },
  });
  expect(open).toBe(true);
});
