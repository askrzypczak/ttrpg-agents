import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { MonsterInstance, ChangeOrigin } from "@ttrpg-agents/engine";
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
import { removeInstance, snapshotMessage } from "./encounter-bridge.js";
import {
  startBridgeServer,
  type BridgeServer,
  type BridgeServerOptions,
} from "./server.js";

const origin: ChangeOrigin = { source: "table", commandId: "test" };

let dir: string;
let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let shadows: MonsterInstance[];
let servers: BridgeServer[];
let sockets: WebSocket[];

async function startServer(
  options: Partial<BridgeServerOptions> = {},
): Promise<BridgeServer> {
  const server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshotMessage(repo, new SqliteTokenArtRepository(db)),
    removeInstance: (id, commandId) => removeInstance(repo, id, commandId),
    ...options,
  });
  servers.push(server);
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-deleted-"));
  db = openDatabase(join(dir, "test.db"));
  repo = new SqliteEncounterRepository(db);
  shadows = repo.addInstances(
    () => [
      { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
      { monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 },
    ],
    origin,
  );
  servers = [];
  sockets = [];
});

afterEach(async () => {
  for (const ws of sockets) ws.close();
  for (const server of servers) await server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const storedIds = () => repo.listInstances().map((i) => i.id);

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

/** Raw JSON: the message type is new to the protocol. */
function tokenDeleted(instanceId: string): string {
  return JSON.stringify({
    v: 1,
    type: "token-deleted",
    id: `token-deleted:${instanceId}`,
    payload: { instanceId },
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

/** Sends token-deleted and waits for the fresh snapshot it answers with. */
async function deleteAndAwaitSnapshot(
  client: Client,
  instanceId: string,
): Promise<MonsterInstance[]> {
  const before = client.snapshots().length;
  client.ws.send(tokenDeleted(instanceId));
  await waitFor(() => client.snapshots().length > before);
  return client.snapshots().at(-1)!;
}

async function expectStillOpen(client: Client): Promise<void> {
  client.ws.send(encodeMessage({ v: 1, type: "ping", id: "p1", payload: {} }));
  await waitFor(() => client.received.some((m) => m.type === "pong"));
  expect(client.ws.readyState).toBe(WebSocket.OPEN);
}

describe("token-deleted over the bridge", () => {
  it("authenticated token-deleted removes the instance and replies with a snapshot without it", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const client = await authed(server);

    const instances = await deleteAndAwaitSnapshot(client, first!.id);

    expect(instances.map((i) => i.id)).toEqual([second!.id]);
    expect(storedIds()).toEqual([second!.id]);
  });

  it("a client with a wrong token claiming role gm is rejected and removes nothing", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const intruder = await connect(server);
    intruder.ws.send(hello("not-the-token", "gm"));
    intruder.ws.send(tokenDeleted(first!.id));

    expect(await intruder.closed).toBe(1008);
    expect(intruder.received[0]).toMatchObject({
      type: "error",
      payload: { code: "bad-token", fatal: true },
    });
    expect(storedIds()).toEqual([first!.id, second!.id]);

    // Control: the same request from an authenticated client is honoured.
    const gm = await authed(server);
    await deleteAndAwaitSnapshot(gm, first!.id);
    expect(storedIds()).toEqual([second!.id]);
  });

  it("token-deleted before hello is rejected unauthenticated and removes nothing", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const early = await connect(server);
    early.ws.send(tokenDeleted(first!.id));

    expect(await early.closed).toBe(1008);
    expect(early.received[0]).toMatchObject({
      type: "error",
      payload: { code: "unauthenticated", fatal: true },
    });
    expect(storedIds()).toEqual([first!.id, second!.id]);

    // Control: the same request after a valid hello is honoured.
    const gm = await authed(server);
    await deleteAndAwaitSnapshot(gm, first!.id);
    expect(storedIds()).toEqual([second!.id]);
  });

  it("a valid token with role player is treated like any other role", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const client = await authed(server, "player");

    const instances = await deleteAndAwaitSnapshot(client, first!.id);

    expect(instances.map((i) => i.id)).toEqual([second!.id]);
    expect(storedIds()).toEqual([second!.id]);
  });

  it("unknown instance id gets a non-fatal unknown-instance error carrying the request id, changes nothing and the connection stays open", async () => {
    const server = await startServer();
    const client = await authed(server);
    const before = repo.listInstances();

    client.ws.send(tokenDeleted("no-such-instance"));
    await waitFor(() => client.errors().length > 0);

    expect(client.errors()[0]).toMatchObject({
      type: "error",
      id: "token-deleted:no-such-instance",
      payload: { code: "unknown-instance", fatal: false },
    });
    expect(repo.listInstances()).toEqual(before);
    await expectStillOpen(client);
  });

  it("a throwing removeInstance hook gets a non-fatal remove-failed error with the request id", async () => {
    const server = await startServer({
      removeInstance: () => {
        throw new Error("database is locked");
      },
    });
    const [first, second] = shadows;
    const client = await authed(server);

    client.ws.send(tokenDeleted(first!.id));
    await waitFor(() => client.errors().length > 0);

    expect(client.errors()[0]).toMatchObject({
      type: "error",
      id: `token-deleted:${first!.id}`,
      payload: { code: "remove-failed", fatal: false },
    });
    expect(storedIds()).toEqual([first!.id, second!.id]);
    await expectStillOpen(client);
  });
});
