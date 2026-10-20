import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { e2eDir } from "./env.js";

/** Fixed bridge token for e2e runs (64 hex chars, as main.ts expects). */
export const E2E_TOKEN = "e2e0".repeat(16);

/** Token file handed to the bridge via BRIDGE_TOKEN_FILE. */
export function writeE2eTokenFile(): string {
  const dir = e2eDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bridge-token");
  writeFileSync(path, E2E_TOKEN + "\n", { mode: 0o600 });
  return path;
}
