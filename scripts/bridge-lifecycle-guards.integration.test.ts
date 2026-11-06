import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bridgeStatus,
  restartBridge,
  startBridge,
  stopBridge,
  type LifecycleOptions,
} from "./bridge-lifecycle.ts";
import {
  readStateFile,
  writeStateFile,
} from "../packages/bridge/src/state-file.ts";

// The lifecycle commands' guards against signalling the wrong process, leaking
// the agent token and waiting forever, each in a temp dir with its own state
// file, token files, database and an ephemeral port.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_TOKEN = "e1".repeat(32);
const AGENT_TOKEN = "a7".repeat(32);
const TIMEOUT = 60_000;
// Each stand-in names `cli.js` on its command line, as a bridge does.
const IDLE = "setInterval(() => {}, 1000)";
const IGNORES_SIGTERM =
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('ready')";

let dir: string;
let statePath: string;
let env: NodeJS.ProcessEnv;
let out: string[];
let err: string[];
let builds: number;
const children: ChildProcess[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-guards-"));
  statePath = join(dir, "config", "bridge-state.json");
  const tokenFile = join(dir, "bridge-token");
  const agentTokenFile = join(dir, "agent-token");
  await writeFile(tokenFile, EXTENSION_TOKEN + "\n", { mode: 0o600 });
  await writeFile(agentTokenFile, AGENT_TOKEN + "\n", { mode: 0o600 });
  const staticDir = join(dir, "static");
  await mkdir(staticDir);
  env = {
    ...process.env,
    BRIDGE_PORT: "0",
    BRIDGE_STATE_FILE: statePath,
    BRIDGE_TOKEN_FILE: tokenFile,
    BRIDGE_AGENT_TOKEN_FILE: agentTokenFile,
    BRIDGE_STATIC_DIR: staticDir,
    TTRPG_AGENTS_DB: join(dir, "encounters.db"),
  };
  out = [];
  err = [];
  builds = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Stand-ins first: one of them ignores SIGTERM.
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited(child);
    }
  }
  const record = await readStateFile(statePath);
  if (record !== null && commandLine(record.pid).includes("cli.js")) {
    process.kill(record.pid, "SIGTERM");
    await waitUntil(() => !alive(record.pid), `pid ${record.pid} to exit`);
  }
  await rm(dir, { recursive: true, force: true });
}, 30_000);

function options(overrides: Partial<LifecycleOptions> = {}): LifecycleOptions {
  return {
    statePath,
    checkout: REPO,
    env,
    build: () => {
      builds += 1;
      return Promise.resolve();
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...overrides,
  };
}

const printed = (): string => [...out, ...err].join("\n");

const gmTabLine = (): string | undefined =>
  [...out, ...err].find((line) => /GM tab/i.test(line));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLine(pid: number): string {
  const ps = spawnSync("ps", ["-o", "args=", "-p", String(pid)], {
    encoding: "utf8",
  });
  return ps.status === 0 ? ps.stdout.trim() : "";
}

/** Pids of live processes whose command line contains `text`. */
function pidsRunning(text: string): number[] {
  const ps = spawnSync("ps", ["-e", "-o", "pid=", "-o", "args="], {
    encoding: "utf8",
  });
  return ps.stdout
    .split("\n")
    .filter((line) => line.includes(text) && !line.includes("<defunct>"))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((done) => child.once("exit", () => done()));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A node process running `code`, with `cli.js` among its arguments. */
async function standIn(code: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", code, "cli.js"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(child);
  await new Promise<void>((done, fail) => {
    child.once("spawn", () => done());
    child.once("error", fail);
  });
  return child;
}

function readyLine(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    let text = "";
    child.stdout?.on("data", (d: Buffer) => {
      text += d.toString();
      if (text.includes("ready")) done();
    });
  });
}

function signalsSentTo(
  spy: { mock: { calls: unknown[][] } },
  pid: number,
): unknown[][] {
  return spy.mock.calls.filter(
    ([target, signal]) => target === pid && signal !== 0,
  );
}

async function startedBridge(): Promise<void> {
  expect(await startBridge(options())).toBe(0);
  out = [];
  err = [];
}

describe("bridge lifecycle guards: identity", () => {
  it(
    "stop sends no signal to a process running cli.js that started at another time than the record says",
    async () => {
      const other = await standIn(IDLE);
      const pid = other.pid!;
      await writeStateFile(statePath, {
        pid,
        port: 1,
        checkout: REPO,
        commit: null,
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
      const kill = vi.spyOn(process, "kill");

      expect(await stopBridge(options())).toBe(0);

      expect(signalsSentTo(kill, pid)).toEqual([]);
      expect(alive(pid)).toBe(true);
      expect(other.exitCode).toBeNull();
      expect(printed()).toMatch(/no bridge is running/i);
    },
    TIMEOUT,
  );
});

describe("bridge lifecycle guards: agent token", () => {
  it(
    "status with an agent token file holding several lines reports the GM tab as unknown without printing any of it",
    async () => {
      await startedBridge();
      const bad = join(dir, "bad-agent-token");
      await writeFile(bad, "first-secret-part\nsecond-secret-part\n", {
        mode: 0o600,
      });

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: bad } }),
        ),
      ).toBe(0);

      expect(gmTabLine()).toMatch(/unknown/i);
      expect(printed()).not.toContain("first-secret-part");
      expect(printed()).not.toContain("second-secret-part");
    },
    TIMEOUT,
  );

  it(
    "status with a missing agent token file reports the GM tab as unknown and names the file",
    async () => {
      await startedBridge();
      const missing = join(dir, "no-such-agent-token");

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: missing } }),
        ),
      ).toBe(0);

      const line = gmTabLine();
      expect(line).toMatch(/unknown/i);
      expect(line).toContain(missing);
      expect(printed()).not.toContain(AGENT_TOKEN);
    },
    TIMEOUT,
  );

  it(
    "status with an agent token the bridge refuses reports the GM tab as unknown with the reason, without printing the token",
    async () => {
      await startedBridge();
      const wrongToken = "b2".repeat(32);
      const wrong = join(dir, "wrong-agent-token");
      await writeFile(wrong, wrongToken + "\n", { mode: 0o600 });

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: wrong } }),
        ),
      ).toBe(0);

      const line = gmTabLine();
      expect(line).toMatch(/unknown/i);
      expect(line).toMatch(/refused|unauthori[sz]ed|401/i);
      expect(printed()).not.toContain(wrongToken);
      expect(printed()).not.toContain(AGENT_TOKEN);
    },
    TIMEOUT,
  );
});

describe("bridge lifecycle guards: time limits", () => {
  it("restart gives up when the bridge outlives SIGTERM, builds nothing and leaves it running without SIGKILL", async () => {
    const startedAt = new Date().toISOString();
    const stubborn = await standIn(IGNORES_SIGTERM);
    await readyLine(stubborn);
    const pid = stubborn.pid!;
    await writeStateFile(statePath, {
      pid,
      port: 1,
      checkout: REPO,
      commit: null,
      startedAt,
    });
    const kill = vi.spyOn(process, "kill");

    expect(await restartBridge(options())).toBe(1);

    expect(builds).toBe(0);
    expect(alive(pid)).toBe(true);
    expect(stubborn.exitCode).toBeNull();
    expect(signalsSentTo(kill, pid)).toEqual([[pid, "SIGTERM"]]);
    expect((await readStateFile(statePath))?.pid).toBe(pid);
  }, 30_000);

  it("start gives up on a bridge that never listens, stops it and exits non-zero", async () => {
    const checkout = join(dir, "checkout");
    const cli = join(checkout, "packages", "bridge", "dist", "cli.js");
    await mkdir(dirname(cli), { recursive: true });
    await writeFile(cli, IDLE + ";\n");

    expect(await startBridge(options({ checkout }))).toBe(1);

    expect(pidsRunning(cli)).toEqual([]);
    expect(await readStateFile(statePath)).toBeNull();
  }, 30_000);
});
