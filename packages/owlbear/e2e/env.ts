import { mkdtempSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run-scoped e2e settings. The config sets them in the main process before any
// worker starts; workers inherit process.env, so they reuse the same run. Each
// worker starts its own bridge on an ephemeral port (worker-bridge.ts), so only
// the shared harness server needs a port allocated here.
const HARNESS_PORT = "E2E_HARNESS_PORT";
const DIR = "E2E_DIR";

/**
 * Sets E2E_HARNESS_PORT and E2E_DIR, each only if unset, so a run never picks
 * a fixed port or a shared temp dir. The port is released after reserving it;
 * a small reuse race is accepted.
 */
export async function allocateRunEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!env[HARNESS_PORT])
    env[HARNESS_PORT] = String(await reserveLoopbackPort());
  if (!env[DIR]) env[DIR] = mkdtempSync(join(tmpdir(), "ttrpg-agents-e2e-"));
}

/** The harness server's port for this run (`e2e/serve.ts`). */
export function harnessPort(): number {
  return Number(requireEnv(HARNESS_PORT));
}

/** Origin of the harness server, a different origin from the extension. */
export function harnessOrigin(): string {
  return `http://127.0.0.1:${harnessPort()}`;
}

/** Per-run temp dir: holds a per-worker subdir (DB and token file) for each worker's bridge. */
export function e2eDir(): string {
  return requireEnv(DIR);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is not set; e2e runs get it from playwright.config.ts (allocateRunEnv)`,
    );
  return value;
}

/** Reserves a loopback port by listening on it, then releases it. */
function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
