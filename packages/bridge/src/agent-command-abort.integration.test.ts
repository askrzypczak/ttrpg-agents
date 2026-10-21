import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer, type BridgeServer } from "./server.js";

const AGENT_TOKEN = "d4".repeat(32);

let dir: string;
let server: BridgeServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-agent-abort-"));
  await writeFile(join(dir, "manifest.json"), "{}");
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    agentToken: AGENT_TOKEN,
  });
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

describe("POST /agent/command with an aborted body", () => {
  it("a request dropped mid-body does not take the bridge down", async () => {
    // An unhandled rejection in the bridge would fail this test run.
    const socket = connect(server.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      "POST /agent/command HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${String(server.port)}\r\n` +
        `Authorization: Bearer ${AGENT_TOKEN}\r\n` +
        "Content-Type: application/json\r\n" +
        "Content-Length: 100\r\n\r\n" +
        '{"n',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await fetch(`http://127.0.0.1:${server.port}/agent/command`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify({ name: "scene-status" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: { code: "not-connected" },
    });
  });
});
