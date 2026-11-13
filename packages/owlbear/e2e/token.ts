import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fixed agent token for e2e runs (authorises `POST /agent/query`). */
export const E2E_AGENT_TOKEN = "a9e0".repeat(16);

/** Agent token file in `dir`, handed to the bridge via BRIDGE_AGENT_TOKEN_FILE. */
export function writeE2eAgentTokenFile(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "agent-token");
  writeFileSync(path, E2E_AGENT_TOKEN + "\n", { mode: 0o600 });
  return path;
}
