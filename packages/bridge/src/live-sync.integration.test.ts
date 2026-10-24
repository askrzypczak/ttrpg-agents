import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ChangeOrigin, MonsterInstance } from "@ttrpg-agents/engine";
import {
  SqliteEncounterLog,
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { broadcastLogEvents, snapshotMessage } from "./encounter-bridge.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

const entry = join(
  dirname(fileURLToPath(import.meta.resolve("@ttrpg-agents/mcp"))),
  "stdio.js",
);

type Snapshot = Extract<BridgeMessage, { type: "encounter-snapshot" }>;
type EncounterEvent = Extract<BridgeMessage, { type: "encounter-event" }>;

interface Connection {
  ws: WebSocket;
  received: BridgeMessage[];
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;
let log: SqliteEncounterLog;
let server: BridgeServer;
let stop: (() => void) | undefined;
let connections: Connection[];
let client: Client | undefined;
let extraDbs: DatabaseSync[];

/** Connects like the extension does and waits for the snapshot after hello. */
async function connect(): Promise<Connection> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
  const connection: Connection = { ws, received: [] };
  connections.push(connection);
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (r.ok) connection.received.push(r.message);
  });
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      id: "h1",
      payload: { role: "gm", extensionVersion: "0", token: server.token },
    }),
  );
  await waitFor(() => snapshotsOf(connection).length > 0);
  expect(connection.received[0]?.type).toBe("hello-ack");
  return connection;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "live-sync-"));
  dbPath = join(dir, "test.db");
  db = openDatabase(dbPath);
  extraDbs = [];
  connections = [];
  const repo = new SqliteEncounterRepository(db);
  const artRepo = new SqliteTokenArtRepository(db);
  log = new SqliteEncounterLog(db);
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshotMessage(repo, artRepo, log),
  });
  stop = broadcastLogEvents(log, server);

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
  for (const { ws } of connections) ws.close();
  await server.close();
  for (const other of extraDbs) other.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const snapshotsOf = (c: Connection): Snapshot[] =>
  c.received.filter((m): m is Snapshot => m.type === "encounter-snapshot");

const eventsOf = (c: Connection): EncounterEvent[] =>
  c.received.filter((m): m is EncounterEvent => m.type === "encounter-event");

/** A second connection to the same database, as another process would hold. */
function otherRepository(): SqliteEncounterRepository {
  const other = openDatabase(dbPath);
  extraDbs.push(other);
  return new SqliteEncounterRepository(other);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function addShadows(extension: Connection): Promise<EncounterEvent> {
  const before = eventsOf(extension).length;
  const added = await client!.callTool({
    name: "add_monsters",
    arguments: { groups: [{ monster: "srd-2024_shadow", count: 2 }] },
  });
  expect(added.isError).toBeFalsy();
  await waitFor(() => eventsOf(extension).length > before);
  return eventsOf(extension).at(-1)!;
}

describe("live sync from the MCP server process", () => {
  it("adding monsters in the MCP server process reaches the client as an added event with seq and source mcp, and no snapshot follows", async () => {
    const extension = await connect();
    const snapshot = snapshotsOf(extension)[0]!;

    const event = await addShadows(extension);

    expect(event.payload.type).toBe("added");
    if (event.payload.type !== "added") return;
    expect(event.payload.instances.map((i) => i.displayName).sort()).toEqual([
      "Shadow 1",
      "Shadow 2",
    ]);
    expect(event.payload.origin.source).toBe("mcp");
    expect(event.payload.seq).toBe(snapshot.payload.seq + 1);
    // Two more poll ticks: still only the connect snapshot.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(snapshotsOf(extension)).toHaveLength(1);
  }, 30_000);

  it("damage in the MCP server process reaches the client as an hp-changed event with the next seq", async () => {
    const extension = await connect();
    const added = await addShadows(extension);
    if (added.payload.type !== "added") throw new Error("expected added");
    const shadow = added.payload.instances.find(
      (i) => i.displayName === "Shadow 1",
    )!;
    const before = eventsOf(extension).length;

    const damaged = await client!.callTool({
      name: "apply_damage",
      arguments: { target: "Shadow 1", amount: 5 },
    });
    expect(damaged.isError).toBeFalsy();
    await waitFor(() => eventsOf(extension).length > before);

    const event = eventsOf(extension).at(-1)!;
    expect(event.payload).toMatchObject({
      type: "hp-changed",
      id: shadow.id,
      currentHp: shadow.currentHp - 5,
      origin: { source: "mcp" },
      seq: added.payload.seq + 1,
    });
  }, 30_000);

  it("a client that reconnects gets a snapshot with the log's latest seq, then events after it", async () => {
    const first = await connect();
    const added = await addShadows(first);
    if (added.payload.type !== "added") throw new Error("expected added");
    const shadow: MonsterInstance = added.payload.instances[0]!;
    const other = otherRepository();
    const mcp: ChangeOrigin = { source: "mcp", commandId: "other-process" };

    // A change while no client is connected.
    first.ws.close();
    other.applyDamage(shadow.id, 3, mcp);
    const second = await connect();

    const snapshot = snapshotsOf(second)[0]!;
    expect(snapshot.payload.seq).toBe(log.latestSeq());
    expect(
      snapshot.payload.instances.find((i) => i.id === shadow.id)?.currentHp,
    ).toBe(shadow.currentHp - 3);

    other.applyDamage(shadow.id, 2, mcp);
    await waitFor(() =>
      eventsOf(second).some((e) => e.payload.seq === snapshot.payload.seq + 1),
    );
    const next = eventsOf(second).find(
      (e) => e.payload.seq === snapshot.payload.seq + 1,
    )!;
    expect(next.payload).toMatchObject({
      type: "hp-changed",
      id: shadow.id,
      currentHp: shadow.currentHp - 5,
      origin: { source: "mcp" },
    });
  }, 30_000);
});
