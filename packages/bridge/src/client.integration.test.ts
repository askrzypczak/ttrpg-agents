import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
} from "@ttrpg-agents/protocol";
import type { AgentQueryResponse, Query } from "@ttrpg-agents/protocol";
import {
  createBridgeClient,
  createBridgeProbe,
  type BridgeClient,
} from "./client.js";
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
            v: PROTOCOL_VERSION,
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
      v: PROTOCOL_VERSION,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0" },
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

/** A fake client answering every query with `response`, recording the queries. */
function fakeClient(response: AgentQueryResponse): BridgeClient & {
  queries: Query[];
} {
  const queries: Query[] = [];
  return {
    queries,
    query(q) {
      queries.push(q);
      return Promise.resolve(response);
    },
  };
}

function failing(code: string): AgentQueryResponse {
  return {
    ok: false,
    error: { code, message: `the bridge says ${code}` },
  } as AgentQueryResponse;
}

function sceneStatus(roomId?: string): AgentQueryResponse {
  return {
    ok: true,
    result: {
      name: "scene-status",
      result: {
        sceneReady: true,
        tokenCount: 0,
        appliedInstanceCount: 0,
        artWaits: [],
        ...(roomId !== undefined ? { roomId } : {}),
      },
    },
  };
}

describe("bridge probe", () => {
  it("the bridge probe reports no-token-file without a query when the agent token file is missing", async () => {
    const client = fakeClient(sceneStatus("room-1"));
    const missing = join(dir, "missing", "agent-token");
    const facts = await createBridgeProbe({
      client,
      port: 5199,
      tokenPath: missing,
    }).check();
    expect(facts).toEqual({
      port: 5199,
      tokenFile: missing,
      answer: { kind: "no-token-file" },
    });
    expect(client.queries).toEqual([]);
  });

  it("the bridge probe reports unreachable when the client throws", async () => {
    const client: BridgeClient = {
      query: () => Promise.reject(new Error("socket hang up")),
    };
    const facts = await createBridgeProbe({
      client,
      port: 5199,
      tokenPath,
    }).check();
    expect(facts.answer).toEqual({ kind: "unreachable" });
  });

  it("the bridge probe maps bridge-unreachable to unreachable, unauthorized to token-refused and not-connected to no-gm-tab", async () => {
    const cases: [string, string][] = [
      ["bridge-unreachable", "unreachable"],
      ["unauthorized", "token-refused"],
      ["not-connected", "no-gm-tab"],
    ];
    for (const [code, kind] of cases) {
      const client = fakeClient(failing(code));
      const facts = await createBridgeProbe({
        client,
        port: 5199,
        tokenPath,
      }).check();
      expect(facts.answer, code).toEqual({ kind });
      expect(client.queries, code).toEqual([{ name: "scene-status" }]);
    }
  });

  it("the bridge probe maps a scene-status result to gm-tab-connected with its room id, and without one when the tab sends none", async () => {
    const withRoom = await createBridgeProbe({
      client: fakeClient(sceneStatus("room-abc")),
      port: 5199,
      tokenPath,
    }).check();
    expect(withRoom.answer).toEqual({
      kind: "gm-tab-connected",
      roomId: "room-abc",
    });

    const withoutRoom = await createBridgeProbe({
      client: fakeClient(sceneStatus()),
      port: 5199,
      tokenPath,
    }).check();
    expect(withoutRoom.answer).toEqual({ kind: "gm-tab-connected" });
  });

  it("the bridge probe maps timeout and query-failed to gm-tab-not-answering", async () => {
    for (const code of ["timeout", "query-failed"]) {
      const facts = await createBridgeProbe({
        client: fakeClient(failing(code)),
        port: 5199,
        tokenPath,
      }).check();
      expect(facts.answer, code).toEqual({ kind: "gm-tab-not-answering" });
    }
  });

  it("the bridge probe maps bad-request and a result for another query to unreachable", async () => {
    const otherQuery: AgentQueryResponse = {
      ok: true,
      result: { name: "scene-tokens", result: { tokens: [] } },
    };
    for (const response of [failing("bad-request"), otherQuery]) {
      const facts = await createBridgeProbe({
        client: fakeClient(response),
        port: 5199,
        tokenPath,
      }).check();
      expect(facts.answer).toEqual({ kind: "unreachable" });
    }
  });

  it("the bridge probe's facts carry the port and the token file path, and not the token", async () => {
    const secret = "probe-secret-token-7f3a9c";
    const secretPath = join(dir, "secret-token");
    await writeFile(secretPath, secret + "\n", { mode: 0o600 });
    for (const response of [
      sceneStatus("room-abc"),
      failing("unauthorized"),
      failing("bridge-unreachable"),
    ]) {
      const facts = await createBridgeProbe({
        client: fakeClient(response),
        port: 6123,
        tokenPath: secretPath,
      }).check();
      expect(facts.port).toBe(6123);
      expect(facts.tokenFile).toBe(secretPath);
      expect(JSON.stringify(facts)).not.toContain(secret);
      expect(JSON.stringify(facts)).not.toContain("the bridge says");
    }
  });
});
