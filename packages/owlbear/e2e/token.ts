import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fixed bridge token for e2e runs (64 hex chars, as main.ts expects). */
export const E2E_TOKEN = "e2e0".repeat(16);

/** Token file handed to the bridge via BRIDGE_TOKEN_FILE. */
export function writeE2eTokenFile(): string {
  const dir = join(tmpdir(), "ttrpg-agents-e2e");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bridge-token");
  writeFileSync(path, E2E_TOKEN + "\n", { mode: 0o600 });
  return path;
}
