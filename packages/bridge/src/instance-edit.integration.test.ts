import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { MonsterInstance } from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { editInstance, snapshotMessage } from "./encounter-bridge.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

let dir: string;
let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let shadows: MonsterInstance[];
let servers: BridgeServer[];
let sockets: WebSocket[];

async function startServer(): Promise<BridgeServer> {
  const server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshotMessage(repo, new SqliteTokenArtRepository(db)),
    editInstance: (edit) => editInstance(repo, edit),
  });
  servers.push(server);
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "instance-edit-"));
  db = openDatabase(join(dir, "test.db"));
  repo = new SqliteEncounterRepository(db);
  shadows = repo.addInstances(() => [
    {
      monsterKey: "shadow",
      displayName: "Shadow 1",
      maxHp: 16,
      armorClass: 12,
    },
    {
      monsterKey: "shadow",
      displayName: "Shadow 2",
      maxHp: 16,
      armorClass: 12,
    },
  ]);
  servers = [];
  sockets = [];
});

afterEach(async () => {
  for (const ws of sockets) ws.close();
  for (const server of servers) await server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const stored = (id: string): MonsterInstance =>
  repo.listInstances().find((i) => i.id === id)!;

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

interface Client {
  ws: WebSocket;
  received: BridgeMessage[];
  /** Resolves with the close code. */
  closed: Promise<number>;
  snapshots(): MonsterInstance[][];
  errors(): Extract<BridgeMessage, { type: "error" }>[];
}

async function connect(server: BridgeServer): Promise<Client> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    s.once("open", () => resolve(s));
    s.once("error", reject);
  });
  sockets.push(ws);
  const received: BridgeMessage[] = [];
  ws.on("message", (data) => {
    const r = decodeMessage(data.toString());
    if (r.ok) received.push(r.message);
  });
  const closed = new Promise<number>((resolve) =>
    ws.once("close", (code) => resolve(code)),
  );
  return {
    ws,
    received,
    closed,
    snapshots: () =>
      received.flatMap((m) =>
        m.type === "encounter-snapshot" ? [m.payload.instances] : [],
      ),
    errors: () => received.flatMap((m) => (m.type === "error" ? [m] : [])),
  };
}

function hello(token: string, role: "gm" | "player" = "gm"): string {
  return encodeMessage({
    v: 1,
    type: "hello",
    id: "h1",
    payload: { role, extensionVersion: "0", token },
  });
}

/** Raw JSON, as the extension sends it. */
function instanceEdit(
  instanceId: string,
  fields: { currentHp?: number; maxHp?: number; armorClass?: number },
): string {
  return JSON.stringify({
    v: 1,
    type: "instance-edit",
    id: `instance-edit:${instanceId}`,
    payload: { instanceId, ...fields },
  });
}

/** Connects and authenticates; resolves once the connect snapshot arrived. */
async function authed(
  server: BridgeServer,
  role: "gm" | "player" = "gm",
): Promise<Client> {
  const client = await connect(server);
  client.ws.send(hello(server.token, role));
  await waitFor(() => client.snapshots().length > 0);
  expect(client.received[0]?.type).toBe("hello-ack");
  return client;
}

/** Sends instance-edit and waits for the fresh snapshot it answers with. */
async function editAndAwaitSnapshot(
  client: Client,
  instanceId: string,
  fields: { currentHp?: number; maxHp?: number; armorClass?: number },
): Promise<MonsterInstance[]> {
  const before = client.snapshots().length;
  client.ws.send(instanceEdit(instanceId, fields));
  await waitFor(() => client.snapshots().length > before);
  return client.snapshots().at(-1)!;
}

async function expectStillOpen(client: Client): Promise<void> {
  client.ws.send(encodeMessage({ v: 1, type: "ping", id: "p1", payload: {} }));
  await waitFor(() => client.received.some((m) => m.type === "pong"));
  expect(client.ws.readyState).toBe(WebSocket.OPEN);
}

describe("instance-edit over the bridge", () => {
  it("bridge: an authenticated instance-edit updates the store and sends a snapshot", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const client = await authed(server);

    const instances = await editAndAwaitSnapshot(client, first!.id, {
      currentHp: 18,
      maxHp: 20,
      armorClass: 14,
    });

    expect(stored(first!.id)).toMatchObject({
      currentHp: 18,
      maxHp: 20,
      armorClass: 14,
    });
    expect(instances.find((i) => i.id === first!.id)).toMatchObject({
      currentHp: 18,
      maxHp: 20,
      armorClass: 14,
    });
    expect(stored(second!.id)).toEqual(second);
  });

  it("bridge: an instance-edit before hello is rejected and the store is unchanged", async () => {
    const server = await startServer();
    const [first] = shadows;
    const before = repo.listInstances();
    const early = await connect(server);
    early.ws.send(instanceEdit(first!.id, { currentHp: 3 }));

    expect(await early.closed).toBe(1008);
    expect(early.received[0]).toMatchObject({
      type: "error",
      payload: { code: "unauthenticated", fatal: true },
    });
    expect(repo.listInstances()).toEqual(before);

    // Control: the same request after a valid hello is honoured.
    const gm = await authed(server);
    await editAndAwaitSnapshot(gm, first!.id, { currentHp: 3 });
    expect(stored(first!.id).currentHp).toBe(3);
  });

  it("bridge: the self-reported role makes no difference to an instance-edit", async () => {
    const server = await startServer();
    const [first] = shadows;

    const player = await authed(server, "player");
    const afterPlayer = await editAndAwaitSnapshot(player, first!.id, {
      currentHp: 7,
    });
    expect(stored(first!.id).currentHp).toBe(7);
    expect(afterPlayer.find((i) => i.id === first!.id)?.currentHp).toBe(7);

    const gm = await authed(server, "gm");
    const afterGm = await editAndAwaitSnapshot(gm, first!.id, {
      currentHp: 4,
    });
    expect(stored(first!.id).currentHp).toBe(4);
    expect(afterGm.find((i) => i.id === first!.id)?.currentHp).toBe(4);
  });

  it("bridge: an instance-edit for an unknown instance gets a non-fatal error with the message id and changes nothing", async () => {
    const server = await startServer();
    const client = await authed(server);
    const before = repo.listInstances();
    const snapshotsBefore = client.snapshots().length;

    client.ws.send(instanceEdit("no-such-instance", { currentHp: 3 }));
    await waitFor(() => client.errors().length > 0);

    expect(client.errors()[0]).toMatchObject({
      type: "error",
      id: "instance-edit:no-such-instance",
      payload: { fatal: false },
    });
    expect(repo.listInstances()).toEqual(before);
    await expectStillOpen(client);
    expect(client.snapshots()).toHaveLength(snapshotsBefore);
  });

  it("bridge: HP above max is clamped in the store and the snapshot carries the clamp", async () => {
    const server = await startServer();
    const [first] = shadows;
    repo.setHp(first!.id, 5);
    const client = await authed(server);

    const instances = await editAndAwaitSnapshot(client, first!.id, {
      currentHp: 99,
    });

    expect(stored(first!.id)).toMatchObject({ currentHp: 16, maxHp: 16 });
    expect(instances.find((i) => i.id === first!.id)).toMatchObject({
      currentHp: 16,
      maxHp: 16,
    });
  });
});
