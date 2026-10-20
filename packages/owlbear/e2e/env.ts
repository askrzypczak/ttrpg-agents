import { mkdtempSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run-scoped e2e settings. The config sets them in the main process before any
// worker starts; workers inherit process.env, so they reuse the same run.
const BRIDGE_PORT = "E2E_BRIDGE_PORT";
const HARNESS_PORT = "E2E_HARNESS_PORT";
const DIR = "E2E_DIR";

/**
 * Sets E2E_BRIDGE_PORT, E2E_HARNESS_PORT and E2E_DIR, each only if unset, so a
 * run never picks fixed ports or a shared temp dir. Ports are held open
 * together (so they differ) and then released; a small reuse race is accepted.
 */
export async function allocateRunEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const portVars = [BRIDGE_PORT, HARNESS_PORT].filter((name) => !env[name]);
  const ports = await reserveLoopbackPorts(portVars.length);
  portVars.forEach((name, i) => {
    env[name] = String(ports[i]);
  });
  if (!env[DIR]) env[DIR] = mkdtempSync(join(tmpdir(), "ttrpg-agents-e2e-"));
}

/** The bridge's port for this run (the real bridge, `BRIDGE_PORT`). */
export function bridgePort(): number {
  return Number(requireEnv(BRIDGE_PORT));
}

/** The harness server's port for this run (`e2e/serve.ts`). */
export function harnessPort(): number {
  return Number(requireEnv(HARNESS_PORT));
}

/** Origin of the real bridge: the extension's origin, which owlbear.rodeo frames. */
export function bridgeOrigin(): string {
  return `http://localhost:${bridgePort()}`;
}

/** Origin of the harness server, a different origin from the extension. */
export function harnessOrigin(): string {
  return `http://127.0.0.1:${harnessPort()}`;
}

/** Per-run temp dir: holds the throwaway DB and the bridge token file. */
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

/** Reserves `count` distinct loopback ports, all listening at once, then releases them. */
async function reserveLoopbackPorts(count: number): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    return await Promise.all(servers.map(listenOnFreePort));
  } finally {
    await Promise.all(servers.map(closeServer));
  }
}

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
