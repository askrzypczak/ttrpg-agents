import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { TokenArt } from "@ttrpg-agents/engine";
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
import { snapshotMessage } from "./encounter-bridge.js";
import {
  startBridgeServer,
  type BridgeServer,
  type BridgeServerOptions,
} from "./server.js";

const shadowArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

let dir: string;
let dbPath: string;
let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let artRepo: SqliteTokenArtRepository;
let servers: BridgeServer[];
let sockets: WebSocket[];

/** A bridge over the current `db`, wired like the CLI. */
async function startServer(
  options: Partial<BridgeServerOptions> = {},
): Promise<BridgeServer> {
  const encounters = repo;
  const art = artRepo;
  const server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () => snapshotMessage(encounters, art),
    setTokenArt: (monsterKey, value) => art.setTokenArt(monsterKey, value),
    ...options,
  });
  servers.push(server);
  return server;
}

function openStore(): void {
  db = openDatabase(dbPath);
  repo = new SqliteEncounterRepository(db);
  artRepo = new SqliteTokenArtRepository(db);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-art-"));
  dbPath = join(dir, "test.db");
  openStore();
  repo.addInstances(() => [
    { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
  ]);
  servers = [];
  sockets = [];
});

afterEach(async () => {
  for (const ws of sockets) ws.close();
  for (const server of servers) await server.close();
  if (db.isOpen) db.close();
  await rm(dir, { recursive: true, force: true });
});

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

type Snapshot = Extract<BridgeMessage, { type: "encounter-snapshot" }>;

interface Client {
  ws: WebSocket;
  received: BridgeMessage[];
  /** Resolves with the close code. */
  closed: Promise<number>;
  snapshots(): Snapshot["payload"][];
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
        m.type === "encounter-snapshot" ? [m.payload] : [],
      ),
    errors: () => received.flatMap((m) => (m.type === "error" ? [m] : [])),
  };
}

function hello(token: string): string {
  return encodeMessage({
    v: 1,
    type: "hello",
    id: "h1",
    payload: { role: "gm", extensionVersion: "0", token },
  });
}

/** Raw JSON: the message type is new to the protocol. */
function tokenArtSet(monsterKey: string, art: TokenArt): string {
  return JSON.stringify({
    v: 1,
    type: "token-art-set",
    payload: { monsterKey, art },
  });
}

/** Connects and authenticates; resolves once the connect snapshot arrived. */
async function authed(server: BridgeServer): Promise<Client> {
  const client = await connect(server);
  client.ws.send(hello(server.token));
  await waitFor(() => client.snapshots().length > 0);
  expect(client.received[0]?.type).toBe("hello-ack");
  return client;
}

/** Sends token-art-set and waits for the fresh snapshot it answers with. */
async function setArtAndAwaitSnapshot(
  client: Client,
  monsterKey: string,
  art: TokenArt,
): Promise<Snapshot["payload"]> {
  const before = client.snapshots().length;
  client.ws.send(tokenArtSet(monsterKey, art));
  await waitFor(
    () => client.snapshots().length > before || client.errors().length > 0,
  );
  expect(client.errors()).toEqual([]);
  return client.snapshots().at(-1)!;
}

async function expectStillOpen(client: Client): Promise<void> {
  client.ws.send(encodeMessage({ v: 1, type: "ping", id: "p1", payload: {} }));
  await waitFor(() => client.received.some((m) => m.type === "pong"));
  expect(client.ws.readyState).toBe(WebSocket.OPEN);
}

describe("token-art-set over the bridge", () => {
  it("the snapshot sent on connect includes the stored art", async () => {
    artRepo.setTokenArt("shadow", shadowArt);
    const server = await startServer();

    const client = await authed(server);

    expect(client.snapshots()[0]?.art).toEqual({ shadow: shadowArt });
  });

  it("token-art-set stores the art and replies with a snapshot carrying it", async () => {
    const server = await startServer();
    const client = await authed(server);

    const snapshot = await setArtAndAwaitSnapshot(client, "shadow", shadowArt);

    expect(snapshot.art).toEqual({ shadow: shadowArt });
    expect(artRepo.listTokenArt()).toEqual({ shadow: shadowArt });
  });

  it("stored art is served again by a restarted bridge", async () => {
    const first = await startServer();
    const client = await authed(first);
    await setArtAndAwaitSnapshot(client, "shadow", shadowArt);
    client.ws.close();
    await first.close();
    servers.splice(servers.indexOf(first), 1);
    db.close();

    openStore();
    const second = await startServer();
    const again = await authed(second);

    expect(again.snapshots()[0]?.art).toEqual({ shadow: shadowArt });
  });

  it("token-art-set from a client that has not authenticated is refused", async () => {
    const server = await startServer();
    const early = await connect(server);
    early.ws.send(tokenArtSet("shadow", shadowArt));

    expect(await early.closed).toBe(1008);
    expect(early.received[0]).toMatchObject({
      type: "error",
      payload: { code: "unauthenticated", fatal: true },
    });
    expect(artRepo.listTokenArt()).toEqual({});

    // Control: the same request after a valid hello is honoured.
    const gm = await authed(server);
    await setArtAndAwaitSnapshot(gm, "shadow", shadowArt);
    expect(artRepo.listTokenArt()).toEqual({ shadow: shadowArt });
  });

  it("token-art-set gets unexpected-type when the server has no art hook", async () => {
    const server = await startServer({ setTokenArt: undefined });
    const client = await authed(server);

    client.ws.send(tokenArtSet("shadow", shadowArt));
    await waitFor(() => client.errors().length > 0);

    expect(client.errors()[0]).toMatchObject({
      type: "error",
      payload: { code: "unexpected-type", fatal: false },
    });
    await expectStillOpen(client);

    // Control: a bridge with the hook accepts the same request.
    const withHook = await startServer();
    const gm = await authed(withHook);
    const snapshot = await setArtAndAwaitSnapshot(gm, "shadow", shadowArt);
    expect(snapshot.art).toEqual({ shadow: shadowArt });
  });

  it("a failing art write answers a non-fatal token-art-failed error and sends no snapshot", async () => {
    const server = await startServer({
      setTokenArt: () => {
        throw new Error("database is locked");
      },
    });
    const client = await authed(server);
    const before = client.snapshots().length;

    client.ws.send(tokenArtSet("shadow", shadowArt));
    await waitFor(() => client.errors().length > 0);

    expect(client.errors()[0]).toMatchObject({
      type: "error",
      payload: { code: "token-art-failed", fatal: false },
    });
    // The pong comes after anything the bridge sent for the art request.
    await expectStillOpen(client);
    expect(client.snapshots()).toHaveLength(before);
  });
});
