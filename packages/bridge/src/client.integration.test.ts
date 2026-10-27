import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { decodeMessage, encodeMessage } from "@ttrpg-agents/protocol";
import { createBridgeClient } from "./client.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

// Real bridge on an ephemeral port; a `ws` client stands in for the extension
// and answers every `query` with a fixed scene-status.
const AGENT_TOKEN = "c1".repeat(32);
const RESULT = {
  name: "scene-status" as const,
  result: {
    sceneReady: true,
    tokenCount: 3,
    appliedInstanceCount: 2,
    artWaits: [],
  },
};

let dir: string;
let tokenPath: string;
let server: BridgeServer | undefined;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-client-"));
  await writeFile(join(dir, "manifest.json"), "{}");
  tokenPath = join(dir, "agent-token");
  await writeFile(tokenPath, AGENT_TOKEN + "\n", { mode: 0o600 });
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await server?.close();
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

async function startWithExtension(): Promise<BridgeServer> {
  const s = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
  });
  server = s;
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, {
      origin: `http://localhost:${s.port}`,
    });
    w.once("open", () => resolve(w));
    w.once("error", reject);
  });
  sockets.push(ws);
  const acked = new Promise<void>((resolve) => {
    ws.on("message", (data) => {
      const r = decodeMessage(data.toString());
      if (!r.ok) return;
      if (r.message.type === "hello-ack") resolve();
      if (r.message.type === "query" && r.message.id !== undefined) {
        ws.send(
          encodeMessage({
            v: 1,
            type: "query-result",
            id: r.message.id,
            payload: RESULT,
          }),
        );
      }
    });
  });
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: s.token },
    }),
  );
  await acked;
  return s;
}

/** A loopback port with nothing listening on it. */
async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("bridge client", () => {
  it("returns the extension's result", async () => {
    const s = await startWithExtension();
    const client = createBridgeClient({ port: s.port, tokenPath });
    expect(await client.query({ name: "scene-status" })).toEqual({
      ok: true,
      result: RESULT,
    });
  });

  it("bridge not listening -> `bridge-unreachable`", async () => {
    const client = createBridgeClient({ port: await unusedPort(), tokenPath });
    expect(await client.query({ name: "scene-status" })).toMatchObject({
      ok: false,
      error: { code: "bridge-unreachable" },
    });
  });

  it("missing token file -> `bridge-unreachable` with a start-the-bridge message", async () => {
    const s = await startWithExtension();
    const client = createBridgeClient({
      port: s.port,
      tokenPath: join(dir, "missing", "agent-token"),
    });
    const response = await client.query({ name: "scene-status" });
    if (response.ok) throw new Error("expected an error response");
    expect(response.error.code).toBe("bridge-unreachable");
    expect(response.error.message).toMatch(/start/i);
    expect(response.error.message).toMatch(/bridge/i);
  });
});
