// The record a running bridge keeps about itself, read by the lifecycle
// commands (`scripts/bridge-lifecycle.ts`). Imports only Node built-ins so the
// root scripts can load it under Node type stripping.
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface BridgeState {
  pid: number;
  port: number;
  /** Absolute path of the checkout the bridge runs from. */
  checkout: string;
  /** `git rev-parse HEAD` of that checkout at start; null when git cannot tell. */
  commit: string | null;
  /** ISO time the process started. */
  startedAt: string;
}

/** `~/.config/ttrpg-agents/bridge-state.json`, beside the token files. */
export function defaultStatePath(): string {
  return join(homedir(), ".config", "ttrpg-agents", "bridge-state.json");
}

/** Writes the record atomically, mode 0600 (directory 0700). */
export async function writeStateFile(
  path: string,
  state: BridgeState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The record, or null when the file is missing or not a valid record. */
export async function readStateFile(path: string): Promise<BridgeState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return asBridgeState(json);
}

function asBridgeState(value: unknown): BridgeState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const r = value as Record<string, unknown>;
  const { pid, port, checkout, commit, startedAt } = r;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
    return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0)
    return null;
  if (typeof checkout !== "string" || checkout === "") return null;
  if (commit !== null && typeof commit !== "string") return null;
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt)))
    return null;
  return { pid, port, checkout, commit, startedAt };
}

/** Removes the file only if it records `pid`; a missing file is fine. */
export async function removeStateFile(
  path: string,
  pid: number,
): Promise<void> {
  const record = await readStateFile(path);
  if (record?.pid !== pid) return;
  await rm(path, { force: true });
}

/** HEAD of the git checkout at `dir`, or null. */
export function checkoutCommit(dir: string): string | null {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}
