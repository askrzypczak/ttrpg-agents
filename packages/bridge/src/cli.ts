import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storeTokenImage } from "@ttrpg-agents/engine";
import {
  SqliteEncounterLog,
  SqliteEncounterRepository,
  SqliteMapRepository,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  broadcastLogEvents,
  editInstance,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";
import { broadcastMapRooms, mapRoomsMessage } from "./map-rooms.js";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "./server.js";
import {
  checkoutCommit,
  defaultStatePath,
  removeStateFile,
  writeStateFile,
} from "./state-file.js";
import { defaultAgentTokenPath, loadOrCreateToken } from "./token-file.js";

const port = process.env.BRIDGE_PORT
  ? Number(process.env.BRIDGE_PORT)
  : DEFAULT_BRIDGE_PORT;
const staticDir =
  process.env.BRIDGE_STATIC_DIR ??
  fileURLToPath(new URL("../../owlbear/dist", import.meta.url));
const statePath = process.env.BRIDGE_STATE_FILE ?? defaultStatePath();
const checkout = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const agentTokenPath =
  process.env.BRIDGE_AGENT_TOKEN_FILE ?? defaultAgentTokenPath();
const agentToken = await loadOrCreateToken(agentTokenPath);

// The snapshot is sent after each hello-ack. Every later change, by the MCP
// server process or by this one, reaches the client as an event polled from the
// change log.
const db = openDatabase();
const repo = new SqliteEncounterRepository(db);
const artRepo = new SqliteTokenArtRepository(db);
const imageRepo = new SqliteTokenImageRepository(db);
const log = new SqliteEncounterLog(db);
const maps = new SqliteMapRepository(db);
const server = await startBridgeServer({
  port,
  staticDir,
  agentToken,
  snapshot: () => snapshotMessage(repo, artRepo, log),
  mapRooms: () => mapRoomsMessage(maps),
  removeInstance: (id, commandId) => removeInstance(repo, id, commandId),
  editInstance: (edit, commandId) => editInstance(repo, edit, commandId),
  setTokenArt: (monsterKey, art) => artRepo.setTokenArt(monsterKey, art),
  storeTokenImage: (bytes) => storeTokenImage(imageRepo, bytes),
  getTokenImage: (sha256) => imageRepo.getTokenImage(sha256),
}).catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(
      `bridge: port ${String(port)} is already in use. Run \`npm run bridge:status\` to see what holds it.`,
    );
    process.exit(1);
  }
  throw error;
});
const stopPolling = broadcastLogEvents(log, server, {
  onUnreadable: ({ seq, error }) =>
    console.error(
      `change log row ${seq} could not be read and was skipped: ${error.replace(/\s+/g, " ")}`,
    ),
  snapshot: () => snapshotMessage(repo, artRepo, log),
});
const stopMapRooms = broadcastMapRooms(maps, server);
// Registered before the state file can exist: a signal right after it appears
// still closes the server and removes it, and one during the write waits for
// it to land (or fail). The handler runs on a later turn, after `stateWritten`
// is assigned below.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopPolling();
    stopMapRooms();
    void server
      .close()
      .then(() => stateWritten.catch(() => undefined))
      .then(() => removeStateFile(statePath, process.pid))
      .then(() => process.exit(0));
  });
}
// Written before the install URL is printed: `bridge:start` waits for this
// record, not for the log.
const stateWritten = writeStateFile(statePath, {
  pid: process.pid,
  port: server.port,
  checkout,
  commit: checkoutCommit(checkout),
  startedAt: new Date(performance.timeOrigin).toISOString(),
});
await stateWritten;
console.log(`bridge listening on http://localhost:${server.port}`);
console.log(`serving ${staticDir}`);
console.log(`agent token file: ${agentTokenPath}`);
console.log(`state file: ${statePath}`);
console.log(
  `install in Owlbear: http://localhost:${server.port}/manifest.json`,
);
