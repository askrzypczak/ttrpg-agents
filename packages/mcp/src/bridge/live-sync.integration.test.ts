import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  SqliteEncounterRepository,
  openDatabase,
  type MonsterInstance,
} from "@ttrpg-agents/core";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/core/bridge";
import {
  broadcastSnapshotsOnChange,
  dataVersion,
  snapshotMessage,
} from "./encounter-bridge.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

const entry = fileURLToPath(new URL("../../dist/stdio.js", import.meta.url));

let dir: string;
let db: DatabaseSync;
let server: BridgeServer;
let stop: (() => void) | undefined;
let ws: WebSocket | undefined;
let client: Client | undefined;
let received: BridgeMessage[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "live-sync-"));
  const dbPath = join(dir, "test.db");
  db = openDatabase(dbPath);
  const repo = new SqliteEncounterRepository(db);
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshotMessage(repo),
  });
  received = [];
  stop = broadcastSnapshotsOnChange(() => dataVersion(db), repo, server, {
    intervalMs: 50,
  });

  ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (r.ok) received.push(r.message);
  });
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      id: "h1",
      payload: { role: "gm", extensionVersion: "0", token: server.token },
    }),
  );
  await waitFor(() => snapshots().length > 0);
  expect(received[0]?.type).toBe("hello-ack");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, TTRPG_AGENTS_DB: dbPath },
  });
  client = new Client({ name: "live-sync", version: "0.0.0" });
  await client.connect(transport);
}, 30_000);

afterEach(async () => {
  await client?.close();
  client = undefined;
  stop?.();
  stop = undefined;
  ws?.close();
  ws = undefined;
  await server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function snapshots(): MonsterInstance[][] {
  return received.flatMap((m) =>
    m.type === "encounter-snapshot" ? [m.payload.instances] : [],
  );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function addShadows(): Promise<MonsterInstance[]> {
  const before = snapshots().length;
  const added = await client!.callTool({
    name: "add_monsters",
    arguments: { groups: [{ monster: "srd-2024_shadow", count: 2 }] },
  });
  expect(added.isError).toBeFalsy();
  await waitFor(() => snapshots().length > before);
  return snapshots().at(-1)!;
}

describe("live sync from the MCP server process", () => {
  it("broadcasts a snapshot with new instances after the MCP server process adds monsters", async () => {
    const instances = await addShadows();
    expect(instances.map((i) => i.displayName).sort()).toEqual([
      "Shadow 1",
      "Shadow 2",
    ]);
  }, 30_000);

  it("broadcasts a snapshot with the new currentHp after the MCP server process applies damage", async () => {
    const instances = await addShadows();
    const shadow = instances.find((i) => i.displayName === "Shadow 1")!;
    const before = snapshots().length;
    const damaged = await client!.callTool({
      name: "apply_damage",
      arguments: { target: "Shadow 1", amount: 5 },
    });
    expect(damaged.isError).toBeFalsy();
    await waitFor(() => snapshots().length > before);
    const after = snapshots()
      .at(-1)!
      .find((i) => i.id === shadow.id);
    expect(after?.currentHp).toBe(shadow.currentHp - 5);
  }, 30_000);
});
