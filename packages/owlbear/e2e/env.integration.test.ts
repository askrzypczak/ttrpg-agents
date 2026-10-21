import { existsSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { allocateRunEnv } from "./env.ts";

// Real sockets and temp dirs; process.env is never touched (fresh env objects).
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Allocates into an empty env and tracks the temp dir it creates. */
async function allocateFresh(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {};
  await allocateRunEnv(env);
  created.push(String(env.E2E_DIR));
  return env;
}

/** True when a listener can take `port` on 127.0.0.1 right now. */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

it("allocateRunEnv picks a free harness port and keeps preset values (AC1)", async () => {
  // Fresh env: only the harness port and the temp dir; each worker starts its own bridge.
  const env = await allocateFresh();
  expect(Object.keys(env).sort()).toEqual(["E2E_DIR", "E2E_HARNESS_PORT"]);
  const harness = Number(env.E2E_HARNESS_PORT);
  expect(harness).toBeGreaterThan(0);
  expect(harness).toBeLessThan(65536);
  expect(await canBind(harness)).toBe(true);

  // Preset env: values already set (workers inherit the main process's run) stay as they are.
  const dir = join(tmpdir(), "ttrpg-agents-e2e-preset");
  const preset = { E2E_HARNESS_PORT: "41002", E2E_DIR: dir };
  await allocateRunEnv(preset);
  expect(preset).toEqual({ E2E_HARNESS_PORT: "41002", E2E_DIR: dir });
  expect(existsSync(dir)).toBe(false);
});

it("allocateRunEnv creates a fresh temp dir per call on an empty env", async () => {
  const first = await allocateFresh();
  const second = await allocateFresh();
  expect(first.E2E_DIR).not.toBe(second.E2E_DIR);
  for (const env of [first, second]) {
    const dir = String(env.E2E_DIR);
    expect(dirname(dir)).toBe(tmpdir());
    expect(basename(dir)).toMatch(/^ttrpg-agents-e2e-/);
    expect(statSync(dir).isDirectory()).toBe(true);
  }
});
