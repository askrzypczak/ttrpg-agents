import { fileURLToPath } from "node:url";
import { DEFAULT_BRIDGE_PORT, startBridgeServer } from "./server.js";

const port = process.env.BRIDGE_PORT
  ? Number(process.env.BRIDGE_PORT)
  : DEFAULT_BRIDGE_PORT;
const staticDir =
  process.env.BRIDGE_STATIC_DIR ??
  fileURLToPath(new URL("../../../owlbear/dist", import.meta.url));

const server = await startBridgeServer({ port, staticDir });
console.log(`bridge listening on http://localhost:${server.port}`);
console.log(`serving ${staticDir}`);
console.log(`manifest: http://localhost:${server.port}/manifest.json`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
