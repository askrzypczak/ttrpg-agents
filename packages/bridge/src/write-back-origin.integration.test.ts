import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ChangeOrigin, EncounterRepository } from "@ttrpg-agents/engine";
import {
  SqliteEncounterLog,
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { decodeMessage, encodeMessage } from "@ttrpg-agents/protocol";
import {
  broadcastLogEvents,
  editInstance,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";
import { startBridgeServer, type BridgeServer } from "./server.js";

let dir: string;
let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let instanceId: string;
let origins: ChangeOrigin[];
let server: BridgeServer;
let socket: WebSocket;
let received: string[];
let log: SqliteEncounterLog;
let stopPolling: (() => void) | undefined;

/** Delegates to `inner` and records the origin of every mutation. */
function recordingRepo(inner: SqliteEncounterRepository): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => inner.getOrCreateActiveEncounter(),
    listInstances: () => inner.listInstances(),
    addInstances: (build, origin) => inner.addInstances(build, origin),
    applyDamage: (id, amount, origin) => inner.applyDamage(id, amount, origin),
    applyHealing: (id, amount, origin) =>
      inner.applyHealing(id, amount, origin),
    removeInstances: (ids, origin) => (
      origins.push(origin),
      inner.removeInstances(ids, origin)
    ),
    listRemovedInstances: () => inner.listRemovedInstances(),
    restoreInstances: (ids, name, origin) =>
      inner.restoreInstances(ids, name, origin),
    renameInstance: (id, name, origin) =>
      inner.renameInstance(id, name, origin),
    setInitiative: (id, initiative, origin) =>
      inner.setInitiative(id, initiative, origin),
    setGroupId: (id, groupId, origin) => inner.setGroupId(id, groupId, origin),
    setHp: (id, hp, origin) => (
      origins.push(origin),
      inner.setHp(id, hp, origin)
    ),
    setMaxHp: (id, maxHp, origin) => inner.setMaxHp(id, maxHp, origin),
    setArmorClass: (id, armorClass, origin) =>
      inner.setArmorClass(id, armorClass, origin),
    setStatsVisible: (id, visible, origin) =>
      inner.setStatsVisible(id, visible, origin),
    setSpawnPositions: (positions, origin) =>
      inner.setSpawnPositions(positions, origin),
    changeMonsters: (changes, origin) => inner.changeMonsters(changes, origin),
    clearEncounter: (origin) => inner.clearEncounter(origin),
    noteCommand: (origin) => inner.noteCommand(origin),
    transaction: (fn) => inner.transaction(fn),
    latestUndoRecord: () => inner.latestUndoRecord(),
    forgetCommands: (ids) => inner.forgetCommands(ids),
  };
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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-back-origin-"));
  db = openDatabase(join(dir, "test.db"));
  repo = new SqliteEncounterRepository(db);
  origins = [];
  const [shadow] = repo.addInstances(
    () => [
      {
        monsterKey: "shadow",
        displayName: "Shadow 1",
        maxHp: 16,
        armorClass: 12,
      },
    ],
    { source: "table", commandId: "seed" },
  );
  instanceId = shadow!.id;
  const recording = recordingRepo(repo);
  log = new SqliteEncounterLog(db);
  server = await startBridgeServer({
    port: 0,
    staticDir: dir,
    snapshot: () =>
      snapshotMessage(repo, new SqliteTokenArtRepository(db), log),
    editInstance: (edit, commandId) => editInstance(recording, edit, commandId),
    removeInstance: (id, commandId) => removeInstance(recording, id, commandId),
  });
  socket = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://localhost:${server.port}`,
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
  received = [];
  socket.on("message", (data) => received.push(data.toString()));
  socket.send(
    encodeMessage({
      v: 1,
      type: "hello",
      id: "h1",
      payload: { role: "gm", extensionVersion: "0", token: server.token },
    }),
  );
  await waitFor(() => received.some((m) => m.includes("encounter-snapshot")));
});

afterEach(async () => {
  stopPolling?.();
  stopPolling = undefined;
  socket.close();
  await server.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

/** Waits until `n` write-backs have reached the repository. */
const awaitWrites = (n: number): Promise<void> =>
  waitFor(() => origins.length >= n);

/** Raw JSON, as the extension sends it. */
function send(message: Record<string, unknown>): void {
  socket.send(JSON.stringify({ v: 1, ...message }));
}

const edit = (id?: string): Record<string, unknown> => ({
  type: "instance-edit",
  ...(id === undefined ? {} : { id }),
  payload: { instanceId, currentHp: 5 },
});

const tokenDeleted = (id?: string): Record<string, unknown> => ({
  type: "token-deleted",
  ...(id === undefined ? {} : { id }),
  payload: { instanceId },
});

describe("write-back origin", () => {
  it.each([
    ["instance-edit", edit, "instance-edit:abc"],
    ["token-deleted", tokenDeleted, "token-deleted:abc"],
  ])(
    "an accepted write-back reaches the client as an encounter-event with source table and the message id (%s)",
    async (_type, build, id) => {
      stopPolling = broadcastLogEvents(log, server);
      const eventOrigins = () =>
        received.flatMap((raw) => {
          const r = decodeMessage(raw);
          return r.ok && r.message.type === "encounter-event"
            ? [r.message.payload.origin]
            : [];
        });

      send(build(id));
      await waitFor(() => eventOrigins().length > 0);

      expect(eventOrigins()).toEqual([{ source: "table", commandId: id }]);
    },
  );

  it("an instance-edit write-back reaches the repository with source table and the message id", async () => {
    send(edit("instance-edit:abc"));
    await awaitWrites(1);

    expect(origins[0]).toEqual({
      source: "table",
      commandId: "instance-edit:abc",
    });
  });

  it("a token-deleted write-back reaches the repository with source table and the message id", async () => {
    send(tokenDeleted("token-deleted:abc"));
    await awaitWrites(1);

    expect(origins[0]).toEqual({
      source: "table",
      commandId: "token-deleted:abc",
    });
  });

  it("a write-back message without an id gets a minted command id", async () => {
    send(edit());
    await awaitWrites(1);
    send(edit());
    await awaitWrites(2);

    expect(origins[0]?.source).toBe("table");
    expect(origins[0]?.commandId).toMatch(/\S/);
    // Each message is its own command.
    expect(origins[1]?.commandId).toMatch(/\S/);
    expect(origins[1]?.commandId).not.toBe(origins[0]?.commandId);
  });

  it("a write-back message with an empty id gets a minted command id", async () => {
    send(tokenDeleted(""));
    await awaitWrites(1);

    expect(origins[0]?.source).toBe("table");
    expect(origins[0]?.commandId).toMatch(/\S/);
  });
});
