import { fileURLToPath } from "node:url";
import {
  SqliteEncounterRepository,
  createEncounterEmitter,
  observeRepository,
  openDatabase,
} from "@ttrpg-agents/core";
import { forwardEncounterEvents, snapshotMessage } from "./encounter-bridge.js";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "./server.js";
import { defaultTokenPath, loadOrCreateToken } from "./token-file.js";

const port = process.env.BRIDGE_PORT
  ? Number(process.env.BRIDGE_PORT)
  : DEFAULT_BRIDGE_PORT;
const staticDir =
  process.env.BRIDGE_STATIC_DIR ??
  fileURLToPath(new URL("../../../owlbear/dist", import.meta.url));
const tokenPath = process.env.BRIDGE_TOKEN_FILE ?? defaultTokenPath();
const token = await loadOrCreateToken(tokenPath);

// The snapshot reads the shared SQLite file, so a connecting extension converges
// on instances added by any process. Live events only cover mutations made
// through `repo` in this process.
const emitter = createEncounterEmitter();
const repo = observeRepository(
  new SqliteEncounterRepository(openDatabase()),
  emitter,
);
const server = await startBridgeServer({
  port,
  staticDir,
  token,
  snapshot: () => snapshotMessage(repo),
});
forwardEncounterEvents(emitter, server);
console.log(`bridge listening on http://localhost:${server.port}`);
console.log(`serving ${staticDir}`);
console.log(`token file: ${tokenPath}`);
console.log(
  `install in Owlbear: http://localhost:${server.port}/manifest.json?token=${token}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
