import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SqliteEncounterRepository,
  SqliteTokenArtRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  broadcastSnapshotsOnChange,
  dataVersion,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "./server.js";
import {
  defaultAgentTokenPath,
  defaultTokenPath,
  loadOrCreateToken,
} from "./token-file.js";

const port = process.env.BRIDGE_PORT
  ? Number(process.env.BRIDGE_PORT)
  : DEFAULT_BRIDGE_PORT;
const staticDir =
  process.env.BRIDGE_STATIC_DIR ??
  fileURLToPath(new URL("../../owlbear/dist", import.meta.url));
const tokenPath = process.env.BRIDGE_TOKEN_FILE ?? defaultTokenPath();
const agentTokenPath =
  process.env.BRIDGE_AGENT_TOKEN_FILE ?? defaultAgentTokenPath();
if (resolve(tokenPath) === resolve(agentTokenPath)) {
  console.error(
    `BRIDGE_TOKEN_FILE and BRIDGE_AGENT_TOKEN_FILE must be different files (both are ${resolve(tokenPath)}): the extension token travels in the manifest URL and must not authorise /agent/query.`,
  );
  process.exit(1);
}
const token = await loadOrCreateToken(tokenPath);
const agentToken = await loadOrCreateToken(agentTokenPath);

// The snapshot is sent after each hello-ack and again whenever another process
// (the MCP server) commits a change, detected by polling PRAGMA data_version.
const db = openDatabase();
const repo = new SqliteEncounterRepository(db);
const artRepo = new SqliteTokenArtRepository(db);
const server = await startBridgeServer({
  port,
  staticDir,
  token,
  agentToken,
  snapshot: () => snapshotMessage(repo, artRepo),
  removeInstance: (id) => removeInstance(repo, id),
  setTokenArt: (monsterKey, art) => artRepo.setTokenArt(monsterKey, art),
});
const stopPolling = broadcastSnapshotsOnChange(
  () => dataVersion(db),
  repo,
  artRepo,
  server,
);
console.log(`bridge listening on http://localhost:${server.port}`);
console.log(`serving ${staticDir}`);
console.log(`token file: ${tokenPath}`);
console.log(`agent token file: ${agentTokenPath}`);
console.log(
  `install in Owlbear: http://localhost:${server.port}/manifest.json?token=${token}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopPolling();
    void server.close().then(() => process.exit(0));
  });
}
