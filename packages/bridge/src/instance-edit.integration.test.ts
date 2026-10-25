import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { MonsterInstance, ChangeOrigin } from "@ttrpg-agents/engine";
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
import {
  broadcastLogEvents,
  editInstance,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

const origin: ChangeOrigin = { source: "table", commandId: "test" };

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
    snapshot: () =>
      snapshotMessage(
        repo,
        new SqliteTokenArtRepository(db),
        new SqliteEncounterLog(db),
      ),
    editInstance: (edit, commandId) => editInstance(repo, edit, commandId),
    removeInstance: (id, commandId) => removeInstance(repo, id, commandId),
    setTokenArt: (monsterKey, art) =>
      new SqliteTokenArtRepository(db).setTokenArt(monsterKey, art),
  });
  servers.push(server);
  return server;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "instance-edit-"));
  db = openDatabase(join(dir, "test.db"));
  repo = new SqliteEncounterRepository(db);
  shadows = repo.addInstances(
    () => [
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

type EditFields = {
  currentHp?: number;
  maxHp?: number;
  armorClass?: number;
  initiative?: number | null;
};

/** Raw JSON, as the extension sends it. */
function instanceEdit(instanceId: string, fields: EditFields): string {
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

let pings = 0;

/** Resolves once the bridge has handled everything this client sent so far. */
async function handled(client: Client): Promise<void> {
  const id = `handled-${++pings}`;
  client.ws.send(encodeMessage({ v: 1, type: "ping", id, payload: {} }));
  await waitFor(() =>
    client.received.some((m) => m.type === "pong" && m.id === id),
  );
}

/** Sends instance-edit and waits until the bridge has handled it. */
async function edit(
  client: Client,
  instanceId: string,
  fields: EditFields,
): Promise<void> {
  client.ws.send(instanceEdit(instanceId, fields));
  await handled(client);
}

async function expectStillOpen(client: Client): Promise<void> {
  await handled(client);
  expect(client.ws.readyState).toBe(WebSocket.OPEN);
}

describe("instance-edit over the bridge", () => {
  it("bridge: an authenticated instance-edit updates the store", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const client = await authed(server);

    await edit(client, first!.id, { currentHp: 18, maxHp: 20, armorClass: 14 });

    expect(stored(first!.id)).toMatchObject({
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
    await edit(gm, first!.id, { currentHp: 3 });
    expect(stored(first!.id).currentHp).toBe(3);
  });

  it("bridge: the self-reported role makes no difference to an instance-edit", async () => {
    const server = await startServer();
    const [first] = shadows;

    const player = await authed(server, "player");
    await edit(player, first!.id, { currentHp: 7 });
    expect(stored(first!.id).currentHp).toBe(7);

    const gm = await authed(server, "gm");
    await edit(gm, first!.id, { currentHp: 4 });
    expect(stored(first!.id).currentHp).toBe(4);
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

  it("bridge: HP above max is clamped in the store", async () => {
    const server = await startServer();
    const [first] = shadows;
    repo.setHp(first!.id, 5, origin);
    const client = await authed(server);

    await edit(client, first!.id, { currentHp: 99 });

    expect(stored(first!.id)).toMatchObject({ currentHp: 16, maxHp: 16 });
  });

  it.each([
    ["instance-edit", (id: string) => instanceEdit(id, { currentHp: 5 })],
    [
      "token-deleted",
      (id: string) =>
        JSON.stringify({
          v: 1,
          type: "token-deleted",
          id: `token-deleted:${id}`,
          payload: { instanceId: id },
        }),
    ],
    [
      "token-art-set",
      () =>
        JSON.stringify({
          v: 1,
          type: "token-art-set",
          payload: {
            monsterKey: "shadow",
            art: {
              url: "https://cdn.owlbear.rodeo/assets/shadow.png",
              mime: "image/png",
              width: 300,
              height: 280,
            },
          },
        }),
    ],
  ])(
    "an accepted command gets no snapshot reply (%s)",
    async (_type, command: (instanceId: string) => string) => {
      const server = await startServer();
      const [first] = shadows;
      const client = await authed(server);
      const before = client.received.length;

      client.ws.send(command(first!.id));
      await handled(client);

      expect(client.errors()).toEqual([]);
      expect(
        client.received
          .slice(before)
          .filter((m) => m.type === "encounter-snapshot"),
      ).toEqual([]);
    },
  );
});

describe("initiative instance-edit over the bridge", () => {
  /** The `encounter-event` messages the client receives from the change log. */
  const events = (client: Client) =>
    client.received.flatMap((m) =>
      m.type === "encounter-event" ? [m.payload] : [],
    );

  it("bridge: an initiative instance-edit reaches the store once and the instance list shows it", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    const client = await authed(server);
    const stop = broadcastLogEvents(new SqliteEncounterLog(db), server);
    try {
      await edit(client, first!.id, { initiative: 14 });
      await waitFor(() => events(client).length > 0);
      // Time for a duplicate event, if the edit were applied twice.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        repo.listInstances().find((i) => i.id === first!.id)?.initiative,
      ).toBe(14);
      expect(stored(second!.id)).toEqual(second);
      expect(events(client)).toHaveLength(1);
      expect(events(client)[0]).toMatchObject({
        type: "instance-changed",
        id: first!.id,
        changes: { initiative: 14 },
        origin: { source: "table", commandId: `instance-edit:${first!.id}` },
      });
    } finally {
      stop();
    }
  });

  it("bridge: a null initiative instance-edit clears the stored initiative", async () => {
    const server = await startServer();
    const [first, second] = shadows;
    repo.setInitiative(first!.id, 12, origin);
    const client = await authed(server);
    const stop = broadcastLogEvents(new SqliteEncounterLog(db), server);
    try {
      await edit(client, first!.id, { initiative: null });
      await waitFor(() => events(client).length > 0);

      expect(stored(first!.id).initiative).toBeNull();
      expect(stored(second!.id)).toEqual(second);
      expect(events(client)[0]).toMatchObject({
        type: "instance-changed",
        id: first!.id,
        changes: { initiative: null },
      });
    } finally {
      stop();
    }
  });
});
