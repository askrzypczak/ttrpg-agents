import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { decodeMessage, encodeMessage } from "@ttrpg-agents/protocol";
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
  type BridgeState,
} from "../packages/bridge/src/state-file.ts";

// Each test runs the lifecycle functions in-process against this checkout's
// built bridge, isolated in a temp dir: its own state file, log, token files,
// database and an ephemeral port. A fake build stands in for `npm run build`.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "packages/bridge/dist/cli.js");
const EXTENSION_TOKEN = "e1".repeat(32);
const AGENT_TOKEN = "a7".repeat(32);
const TIMEOUT = 60_000;
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO,
  encoding: "utf8",
}).trim();

let dir: string;
let statePath: string;
let logPath: string;
let env: NodeJS.ProcessEnv;
let out: string[];
let err: string[];
let builds: number;
const children: ChildProcess[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const bridgePids = new Set<number>();
const standIns: ChildProcess[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-lifecycle-"));
  statePath = join(dir, "config", "bridge-state.json");
  logPath = join(dirname(statePath), "bridge.log");
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
  for (const child of standIns.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited(child);
    }
  }
  for (const ws of sockets.splice(0)) ws.terminate();
  const record = await rawRecord();
  if (typeof record?.pid === "number") bridgePids.add(record.pid);
  for (const pid of bridgePids) await stopIfBridge(pid);
  bridgePids.clear();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited(child);
    }
  }
  for (const server of servers.splice(0))
    await new Promise<void>((done) => server.close(() => done()));
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

/** SIGTERMs `pid` only if it is a bridge CLI process, then waits for it. */
async function stopIfBridge(pid: number): Promise<void> {
  if (!alive(pid) || !commandLine(pid).includes("cli.js")) return;
  process.kill(pid, "SIGTERM");
  await waitFor(
    () => Promise.resolve(alive(pid) ? undefined : true),
    `pid ${pid} to exit`,
  );
}

function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child.exitCode);
  return new Promise((done) => child.once("exit", (code) => done(code)));
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  what: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function rawRecord(): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Starts a bridge through `startBridge` and returns its record. */
async function started(
  overrides: Partial<LifecycleOptions> = {},
): Promise<BridgeState> {
  const code = await startBridge(options(overrides));
  expect(code).toBe(0);
  const record = await readStateFile(statePath);
  expect(record).not.toBeNull();
  bridgePids.add(record!.pid);
  return record!;
}

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function listenOn(port: number): Promise<Server> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done());
  });
  return server;
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  return address.port;
}

function spawnTracked(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd: REPO,
    env,
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

/** process.kill calls that send a real signal (not the 0 liveness probe). */
function signalsSentTo(
  spy: { mock: { calls: unknown[][] } },
  pid: number,
): unknown[][] {
  return spy.mock.calls.filter(
    ([target, signal]) => target === pid && signal !== 0,
  );
}

// Code for stand-in processes, which name `cli.js` on their command line as a
// bridge does.
const IDLE = "setInterval(() => {}, 1000)";
const IGNORES_SIGTERM =
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('ready')";

/** A node process running `code`, with `cli.js` among its arguments. */
async function standIn(code: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", code, "cli.js"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  standIns.push(child);
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

const warningLines = (lines: string[]): string[] =>
  lines.filter((line) => /warn|differ/i.test(line));

const gmTabLine = (lines: string[]): string | undefined =>
  lines.find((line) => /GM tab/i.test(line));

/** A stand-in extension: authenticates, then answers every query with a scene status. */
async function extension(port: number): Promise<WebSocket> {
  const ws = await new Promise<WebSocket>((done, fail) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://localhost:${port}`,
    });
    s.once("open", () => done(s));
    s.once("error", fail);
  });
  sockets.push(ws);
  const acked = new Promise<void>((done) => {
    ws.on("message", (data) => {
      const r = decodeMessage(String(data));
      if (!r.ok) return;
      if (r.message.type === "hello-ack") done();
      if (r.message.type === "query") {
        const id = r.message.id;
        ws.send(
          encodeMessage({
            v: 1,
            type: "query-result",
            ...(id !== undefined ? { id } : {}),
            payload: {
              name: "scene-status",
              result: {
                sceneReady: true,
                tokenCount: 0,
                appliedInstanceCount: 0,
                artWaits: [],
              },
            },
          }),
        );
      }
    });
  });
  ws.send(
    encodeMessage({
      v: 1,
      type: "hello",
      payload: { role: "gm", extensionVersion: "0", token: EXTENSION_TOKEN },
    }),
  );
  await acked;
  return ws;
}

describe("bridge lifecycle: start", () => {
  it(
    "start calls build before it spawns the bridge, and spawns nothing until build resolves",
    async () => {
      let releaseBuild = (): void => {};
      let buildCalled = false;
      const pending = startBridge(
        options({
          build: () => {
            buildCalled = true;
            return new Promise<void>((done) => (releaseBuild = done));
          },
        }),
      );
      pending.catch(() => {});

      await waitFor(
        () => Promise.resolve(buildCalled ? true : undefined),
        "build to be called",
        5_000,
      );
      // Nothing can be awaited for "not spawned": give a spawn time to show.
      await new Promise((r) => setTimeout(r, 1_000));
      expect(await exists(logPath)).toBe(false);
      expect(await exists(statePath)).toBe(false);

      releaseBuild();
      expect(await pending).toBe(0);
      const record = await readStateFile(statePath);
      expect(record).not.toBeNull();
      bridgePids.add(record!.pid);
    },
    TIMEOUT,
  );

  it(
    "start with no BRIDGE_STATIC_DIR serves <checkout>/packages/owlbear/dist, as the bridge's `serving` log line shows",
    async () => {
      const withoutStatic = { ...env };
      delete withoutStatic.BRIDGE_STATIC_DIR;
      await started({ env: withoutStatic });
      const expected = `serving ${join(REPO, "packages/owlbear/dist")}`;
      const log = await waitFor(async () => {
        const text = await readFile(logPath, "utf8").catch(() => "");
        return text.split("\n").includes(expected) ? text : undefined;
      }, "the serving line in the log");
      expect(log.split("\n")).toContain(expected);
    },
    TIMEOUT,
  );

  it(
    "start returns with the bridge already accepting connections, in its own process group",
    async () => {
      const record = await started();
      expect(await accepts(record.port)).toBe(true);
      const pgid = execFileSync(
        "ps",
        ["-o", "pgid=", "-p", String(record.pid)],
        {
          encoding: "utf8",
        },
      ).trim();
      expect(Number(pgid)).toBe(record.pid);
      expect(record.pid).not.toBe(process.pid);
    },
    TIMEOUT,
  );

  it(
    "start with a failing build exits non-zero and starts no bridge",
    async () => {
      const code = await startBridge(
        options({ build: () => Promise.reject(new Error("vite failed")) }),
      );
      expect(code).not.toBe(0);
      expect(await exists(statePath)).toBe(false);
      expect(await exists(logPath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "start exits non-zero with the bridge's error line when the bridge exits before listening",
    async () => {
      // The CLI refuses to start when both token paths name the same file.
      const code = await startBridge(
        options({
          env: { ...env, BRIDGE_AGENT_TOKEN_FILE: env.BRIDGE_TOKEN_FILE },
        }),
      );
      expect(code).not.toBe(0);
      expect(printed()).toContain(
        "BRIDGE_TOKEN_FILE and BRIDGE_AGENT_TOKEN_FILE must be different files",
      );
      expect(await exists(statePath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "start creates the log file with mode 0600",
    async () => {
      await started();
      expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    },
    TIMEOUT,
  );

  it(
    "start resets an existing log file to mode 0600",
    async () => {
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(logPath, "an old run\n");
      await chmod(logPath, 0o644);
      await started();
      expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    },
    TIMEOUT,
  );

  it(
    "start with a bridge already running exits non-zero, names it, does not build, and leaves it running",
    async () => {
      const first = await started();
      builds = 0;
      out = [];
      err = [];

      const code = await startBridge(options());

      expect(code).not.toBe(0);
      expect(builds).toBe(0);
      expect(printed()).toContain(String(first.pid));
      expect(alive(first.pid)).toBe(true);
      expect(await accepts(first.port)).toBe(true);
      expect((await readStateFile(statePath))?.pid).toBe(first.pid);
    },
    TIMEOUT,
  );

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

describe("bridge lifecycle: stop", () => {
  it(
    "stop stops a bridge started by start, frees its port and removes the state file",
    async () => {
      const record = await started();
      expect(await stopBridge(options())).toBe(0);
      expect(alive(record.pid)).toBe(false);
      expect(await exists(statePath)).toBe(false);
      await listenOn(record.port);
    },
    TIMEOUT,
  );

  it(
    "stop stops a foreground bridge started from packages/bridge/dist/cli.js",
    async () => {
      const child = spawnTracked([CLI]);
      const record = await waitFor(async () => {
        if (child.exitCode !== null)
          throw new Error(`the bridge exited (${String(child.exitCode)})`);
        const r = await rawRecord();
        return r?.pid === child.pid ? r : undefined;
      }, "the foreground bridge's state file");

      expect(await stopBridge(options())).toBe(0);
      await exited(child);
      expect(child.exitCode ?? child.signalCode).not.toBeNull();
      expect(await exists(statePath)).toBe(false);
      expect(await accepts(Number(record.port))).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "stop with no state file succeeds and says no bridge is running",
    async () => {
      expect(await stopBridge(options())).toBe(0);
      expect(printed()).toMatch(/no bridge is running/i);
    },
    TIMEOUT,
  );

  it(
    "stop with a state file whose pid is dead signals nothing, removes the stale file and succeeds",
    async () => {
      const gone = spawnTracked(["-e", ""]);
      await exited(gone);
      const pid = gone.pid!;
      await writeStateFile(statePath, {
        pid,
        port: 1,
        checkout: REPO,
        commit: HEAD,
        startedAt: new Date().toISOString(),
      });
      const kill = vi.spyOn(process, "kill");

      expect(await stopBridge(options())).toBe(0);

      expect(signalsSentTo(kill, pid)).toEqual([]);
      expect(await exists(statePath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "stop with a state file whose pid is a live unrelated process leaves that process running",
    async () => {
      const unrelated = spawnTracked(["-e", "setInterval(() => {}, 1000)"]);
      const pid = unrelated.pid!;
      await writeStateFile(statePath, {
        pid,
        port: 1,
        checkout: REPO,
        commit: HEAD,
        startedAt: new Date().toISOString(),
      });
      const kill = vi.spyOn(process, "kill");

      await stopBridge(options());

      expect(signalsSentTo(kill, pid)).toEqual([]);
      expect(unrelated.exitCode).toBeNull();
      expect(unrelated.signalCode).toBeNull();
      expect(alive(pid)).toBe(true);
    },
    TIMEOUT,
  );

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

describe("bridge lifecycle: restart", () => {
  it(
    "restart replaces the running bridge with a new one from this checkout, shown by status",
    async () => {
      const first = await started();
      builds = 0;

      expect(await restartBridge(options())).toBe(0);

      expect(builds).toBe(1);
      const second = await readStateFile(statePath);
      expect(second).not.toBeNull();
      bridgePids.add(second!.pid);
      expect(second!.pid).not.toBe(first.pid);
      expect(alive(first.pid)).toBe(false);
      expect(second!.checkout).toBe(REPO);

      out = [];
      err = [];
      expect(await bridgeStatus(options())).toBe(0);
      expect(printed()).toContain(String(second!.pid));
      expect(printed()).toContain(REPO);
      expect(warningLines([...out, ...err])).toEqual([]);
    },
    TIMEOUT,
  );

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
});

describe("bridge lifecycle: status", () => {
  it(
    "status of a running bridge reports pid, port, checkout, commit and start time",
    async () => {
      const record = await started();
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);

      const text = printed();
      expect(text).not.toMatch(/not running/i);
      expect(text).toMatch(/running/i);
      expect(text).toContain(String(record.pid));
      expect(text).toContain(String(record.port));
      expect(text).toContain(REPO);
      expect(text).toContain(HEAD);
      expect(text).toContain(record.startedAt);
      expect(text).toContain(logPath);
    },
    TIMEOUT,
  );

  it(
    "status warns when the running bridge's checkout differs from this checkout",
    async () => {
      const record = await started();
      out = [];
      err = [];
      await bridgeStatus(options());
      expect(warningLines([...out, ...err])).toEqual([]);

      const elsewhere = join(dir, "other-checkout");
      await mkdir(elsewhere);
      await writeStateFile(statePath, { ...record, checkout: elsewhere });
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);

      const warnings = warningLines([...out, ...err]);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.join("\n")).toMatch(/checkout/i);
      expect(printed()).toContain(String(record.pid));
    },
    TIMEOUT,
  );

  it(
    "status warns when the running bridge's commit differs from this checkout's",
    async () => {
      const record = await started();
      out = [];
      err = [];
      await bridgeStatus(options());
      expect(warningLines([...out, ...err])).toEqual([]);

      const otherCommit = "0".repeat(40);
      await writeStateFile(statePath, { ...record, commit: otherCommit });
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);

      const warnings = warningLines([...out, ...err]);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.join("\n")).toMatch(/commit/i);
    },
    TIMEOUT,
  );

  it(
    "status reports not running for no state file and for a stale record",
    async () => {
      expect(await bridgeStatus(options())).toBe(0);
      expect(printed()).toMatch(/not running/i);

      const gone = spawnTracked(["-e", ""]);
      await exited(gone);
      await writeStateFile(statePath, {
        pid: gone.pid!,
        port: 1,
        checkout: REPO,
        commit: HEAD,
        startedAt: new Date().toISOString(),
      });
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);
      expect(printed()).toMatch(/not running/i);
    },
    TIMEOUT,
  );

  it(
    "start, status and stop never print the extension or agent token",
    async () => {
      await started();
      expect(await bridgeStatus(options())).toBe(0);
      expect(await stopBridge(options())).toBe(0);

      const text = printed();
      expect(text).not.toContain(EXTENSION_TOKEN);
      expect(text).not.toContain(AGENT_TOKEN);
    },
    TIMEOUT,
  );

  it(
    "status reports the GM tab as not connected when no extension client is connected",
    async () => {
      await started();
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);

      const line = gmTabLine([...out, ...err]);
      expect(line).toBeDefined();
      expect(line).toMatch(/not connected/i);
    },
    TIMEOUT,
  );

  it(
    "status reports the GM tab as connected when an extension client answers queries",
    async () => {
      const record = await started();
      await extension(record.port);
      out = [];
      err = [];

      expect(await bridgeStatus(options())).toBe(0);

      const line = gmTabLine([...out, ...err]);
      expect(line).toBeDefined();
      expect(line).toMatch(/connected/i);
      expect(line).not.toMatch(/not connected|unknown/i);
    },
    TIMEOUT,
  );

  it(
    "status with no live record says the port still accepts connections when something listens on it",
    async () => {
      const holder = await listenOn(0);
      const port = portOf(holder);

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_PORT: String(port) } }),
        ),
      ).toBe(0);

      expect(printed()).toMatch(/not running/i);
      const line = [...out, ...err].find((l) => l.includes(`port ${port}`));
      expect(line).toBeDefined();
      expect(line).toMatch(/accept/i);
    },
    TIMEOUT,
  );

  it(
    "status with an agent token file holding several lines reports the GM tab as unknown without printing any of it",
    async () => {
      await started();
      out = [];
      err = [];
      const bad = join(dir, "bad-agent-token");
      await writeFile(bad, "first-secret-part\nsecond-secret-part\n", {
        mode: 0o600,
      });

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: bad } }),
        ),
      ).toBe(0);

      expect(gmTabLine([...out, ...err])).toMatch(/unknown/i);
      expect(printed()).not.toContain("first-secret-part");
      expect(printed()).not.toContain("second-secret-part");
    },
    TIMEOUT,
  );
  it(
    "status with a missing agent token file reports the GM tab as unknown and names the file",
    async () => {
      await started();
      out = [];
      err = [];
      const missing = join(dir, "no-such-agent-token");

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: missing } }),
        ),
      ).toBe(0);

      const line = gmTabLine([...out, ...err]);
      expect(line).toMatch(/unknown/i);
      expect(line).toContain(missing);
      expect(printed()).not.toContain(AGENT_TOKEN);
    },
    TIMEOUT,
  );
  it(
    "status with an agent token the bridge refuses reports the GM tab as unknown with the reason, without printing the token",
    async () => {
      await started();
      out = [];
      err = [];
      const wrongToken = "b2".repeat(32);
      const wrong = join(dir, "wrong-agent-token");
      await writeFile(wrong, wrongToken + "\n", { mode: 0o600 });

      expect(
        await bridgeStatus(
          options({ env: { ...env, BRIDGE_AGENT_TOKEN_FILE: wrong } }),
        ),
      ).toBe(0);

      const line = gmTabLine([...out, ...err]);
      expect(line).toMatch(/unknown/i);
      expect(line).toMatch(/refused|unauthori[sz]ed|401/i);
      expect(printed()).not.toContain(wrongToken);
      expect(printed()).not.toContain(AGENT_TOKEN);
    },
    TIMEOUT,
  );
});
