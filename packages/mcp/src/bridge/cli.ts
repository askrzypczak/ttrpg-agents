import { fileURLToPath } from "node:url";
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

const server = await startBridgeServer({ port, staticDir, token });
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
