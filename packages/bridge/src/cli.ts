import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeProfile, loadConfig } from "@ttrpg-agents/config";
import { openScene, storeTokenImage } from "@ttrpg-agents/engine";
import {
  SqliteEncounterLog,
  SqliteEncounterDirectory,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  broadcastLogEvents,
  createSnapshotSource,
  editInstance,
  removeInstance,
} from "./encounter-bridge.js";
import { broadcastMapRooms, mapRoomsMessage } from "./map-rooms.js";
import { startBridgeServer } from "./server.js";
import {
  checkoutCommit,
  removeStateFile,
  writeStateFile,
} from "./state-file.js";
import { loadOrCreateToken } from "./token-file.js";

const checkout = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const { profile, settings, problems } = loadConfig({
  env: process.env,
  home: homedir(),
  checkout,
});
for (const problem of problems) console.error(problem.message);
if (problems.some((p) => p.level === "error")) process.exit(1);
const port = settings.bridgePort;
const staticDir = settings.extensionDir;
const statePath = settings.bridgeStateFile;
const agentTokenPath = settings.agentTokenFile;
const agentToken = await loadOrCreateToken(agentTokenPath);

// The snapshot is sent after each hello-ack and each scene-open. Every later
// change, by the MCP server process or by this one, reaches the client as an
// event polled from the change log; a change of the open scene, its encounter
// or that encounter's name, which writes no event, as a fresh snapshot.
const db = openDatabase(settings.database);
const encounters = new SqliteEncounterDirectory(db);
const artRepo = new SqliteTokenArtRepository(db);
const imageRepo = new SqliteTokenImageRepository(db);
const log = new SqliteEncounterLog(db);
const snapshots = createSnapshotSource(encounters, artRepo, log);
const server = await startBridgeServer({
  port,
  staticDir,
  agentToken,
  snapshot: snapshots.snapshot,
  mapRooms: () => mapRoomsMessage(encounters),
  removeInstance: (id, commandId) => removeInstance(encounters, id, commandId),
  editInstance: (edit, commandId) => editInstance(encounters, edit, commandId),
  setTokenArt: (monsterKey, art) => artRepo.setTokenArt(monsterKey, art),
  storeTokenImage: (bytes) => storeTokenImage(imageRepo, bytes),
  getTokenImage: (sha256) => imageRepo.getTokenImage(sha256),
  openScene: (sceneId) => openScene(encounters, sceneId),
}).catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(
      `bridge: port ${String(port)} is already in use. Run \`npm run bridge:status\` to see what holds it.`,
    );
    process.exit(1);
  }
  throw error;
});
// No GM tab is connected yet, so no scene is open: one an earlier run left
// open is cleared. This runs once the port is ours (a bridge that fails on a
// taken port leaves the running one's scene alone) and before any client
// message can be handled.
openScene(encounters, null);
const stopPolling = broadcastLogEvents(log, server, {
  onUnreadable: ({ seq, error }) =>
    console.error(
      `change log row ${seq} could not be read and was skipped: ${error.replace(/\s+/g, " ")}`,
    ),
  snapshot: snapshots.snapshot,
  scopeChanged: snapshots.changed,
});
const stopMapRooms = broadcastMapRooms(encounters, server);
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
console.log(`profile: ${describeProfile(profile)}`);
console.log(`serving ${staticDir}`);
console.log(`agent token file: ${agentTokenPath}`);
console.log(`state file: ${statePath}`);
console.log(
  `install in Owlbear: http://localhost:${server.port}/manifest.json`,
);
