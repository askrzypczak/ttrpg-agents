import { fileURLToPath } from "node:url";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import {
  broadcastSnapshotsOnChange,
  dataVersion,
  snapshotMessage,
} from "./encounter-bridge.js";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "./server.js";
import { defaultTokenPath, loadOrCreateToken } from "./token-file.js";

const port = process.env.BRIDGE_PORT
  ? Number(process.env.BRIDGE_PORT)
  : DEFAULT_BRIDGE_PORT;
const staticDir =
  process.env.BRIDGE_STATIC_DIR ??
  fileURLToPath(new URL("../../owlbear/dist", import.meta.url));
const tokenPath = process.env.BRIDGE_TOKEN_FILE ?? defaultTokenPath();
const token = await loadOrCreateToken(tokenPath);

// The snapshot is sent after each hello-ack and again whenever another process
// (the MCP server) commits a change, detected by polling PRAGMA data_version.
const db = openDatabase();
const repo = new SqliteEncounterRepository(db);
const server = await startBridgeServer({
  port,
  staticDir,
  token,
  snapshot: () => snapshotMessage(repo),
});
const stopPolling = broadcastSnapshotsOnChange(
  () => dataVersion(db),
  repo,
  server,
);
console.log(`bridge listening on http://localhost:${server.port}`);
console.log(`serving ${staticDir}`);
console.log(`token file: ${tokenPath}`);
console.log(
  `install in Owlbear: http://localhost:${server.port}/manifest.json?token=${token}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopPolling();
    void server.close().then(() => process.exit(0));
  });
}
