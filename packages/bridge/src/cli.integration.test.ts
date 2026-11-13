import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { resolveEncounter } from "@ttrpg-agents/engine";
import {
  SqliteEncounterDirectory,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";

// The real bridge CLI as a child process, isolated in a temp dir: its own state
// file, token files, database and an ephemeral port.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = join(REPO, "packages/bridge/dist/cli.js");
const EXTENSION_TOKEN = "e1".repeat(32);
const AGENT_TOKEN = "a7".repeat(32);
const TIMEOUT = 60_000;

let dir: string;
let statePath: string;
let env: NodeJS.ProcessEnv;
const children: ChildProcess[] = [];
const servers: Server[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-cli-"));
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
});

afterEach(async () => {
  for (const child of children.splice(0)) await stopChild(child);
  for (const server of servers.splice(0))
    await new Promise<void>((done) => server.close(() => done()));
  await rm(dir, { recursive: true, force: true });
}, 30_000);

function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child.exitCode);
  return new Promise((done) => child.once("exit", (code) => done(code)));
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await exited(child);
}

interface Spawned {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

function spawnTracked(command: string, args: string[]): Spawned {
  const child = spawn(command, args, {
    cwd: REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
  return { child, stdout: () => out, stderr: () => err };
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

/** Waits until the state file records `pid`, failing early if the CLI exits. */
async function recordOf(spawned: Spawned): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    if (spawned.child.exitCode !== null)
      throw new Error(
        `the bridge exited (${String(spawned.child.exitCode)}): ${spawned.stderr()}`,
      );
    const record = await rawRecord();
    return record?.pid === spawned.child.pid ? record : undefined;
  }, "the state file to record the bridge's pid");
}

async function listeningPort(spawned: Spawned): Promise<number> {
  return waitFor(() => {
    const m = /bridge listening on http:\/\/localhost:(\d+)/.exec(
      spawned.stdout(),
    );
    return Promise.resolve(m ? Number(m[1]) : undefined);
  }, "the listening line");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("bridge CLI", () => {
  it(
    "the bridge prints the install URL with no token",
    async () => {
      const bridge = spawnTracked(process.execPath, [CLI]);
      const port = await listeningPort(bridge);
      const line = await waitFor(() => {
        const m = /^install in Owlbear: .*$/m.exec(bridge.stdout());
        return Promise.resolve(m ? m[0] : undefined);
      }, "the install line");

      expect(line).toBe(
        `install in Owlbear: http://localhost:${String(port)}/manifest.json`,
      );
      expect(bridge.stdout()).not.toContain(EXTENSION_TOKEN);
    },
    TIMEOUT,
  );

  it(
    "the bridge creates no extension token file, neither at BRIDGE_TOKEN_FILE nor at the default path under HOME",
    async () => {
      const home = join(dir, "home");
      await mkdir(home);
      env.HOME = home;
      const named = join(dir, "missing", "bridge-token");
      const defaultPath = join(home, ".config", "ttrpg-agents", "bridge-token");

      env.BRIDGE_TOKEN_FILE = named;
      const withVariable = spawnTracked(process.execPath, [CLI]);
      await listeningPort(withVariable);
      await recordOf(withVariable);
      await stopChild(withVariable.child);
      expect(await exists(named)).toBe(false);
      expect(await exists(defaultPath)).toBe(false);

      delete env.BRIDGE_TOKEN_FILE;
      const withoutVariable = spawnTracked(process.execPath, [CLI]);
      await listeningPort(withoutVariable);
      await recordOf(withoutVariable);
      await stopChild(withoutVariable.child);
      expect(await exists(defaultPath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "a manifest request with an old install URL's ?token= gets the manifest as built, even when BRIDGE_TOKEN_FILE holds that token",
    async () => {
      const built =
        JSON.stringify(
          { name: "t", action: { popover: "/index.html" } },
          null,
          2,
        ) + "\n";
      await writeFile(join(dir, "static", "manifest.json"), built);
      const bridge = spawnTracked(process.execPath, [CLI]);
      const port = await listeningPort(bridge);

      const res = await fetch(
        `http://127.0.0.1:${String(port)}/manifest.json?token=${EXTENSION_TOKEN}`,
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(built);
    },
    TIMEOUT,
  );

  it(
    "once listening, the bridge records its pid, port, checkout, commit and start time in the state file",
    async () => {
      const spawnedAt = Date.now();
      const bridge = spawnTracked(process.execPath, [CLI]);
      const port = await listeningPort(bridge);
      const record = await recordOf(bridge);

      expect(record.pid).toBe(bridge.child.pid);
      expect(record.port).toBe(port);
      expect(await realpath(String(record.checkout))).toBe(
        await realpath(REPO),
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: REPO,
        encoding: "utf8",
      }).trim();
      expect(record.commit).toBe(head);
      expect(typeof record.startedAt).toBe("string");
      const startedAt = Date.parse(String(record.startedAt));
      expect(new Date(startedAt).toISOString()).toBe(record.startedAt);
      expect(Math.abs(startedAt - spawnedAt)).toBeLessThan(5_000);
    },
    TIMEOUT,
  );

  it(
    "the bridge creates the state file with mode 0600",
    async () => {
      const bridge = spawnTracked(process.execPath, [CLI]);
      await recordOf(bridge);
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    },
    TIMEOUT,
  );

  it(
    "SIGTERM closes the bridge and removes its state file",
    async () => {
      const bridge = spawnTracked(process.execPath, [CLI]);
      await recordOf(bridge);
      bridge.child.kill("SIGTERM");
      expect(await exited(bridge.child)).toBe(0);
      expect(await exists(statePath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "SIGTERM sent the moment the state file appears closes the bridge and leaves no state file",
    async () => {
      const stateDir = dirname(statePath);
      await mkdir(stateDir, { recursive: true });
      let signalled = false;
      const stopWatching = (): void => {
        watcher.close();
        clearInterval(poll);
      };
      const signalIfWritten = (): void => {
        if (signalled || !existsSync(statePath)) return;
        signalled = true;
        bridge.child.kill("SIGTERM");
        stopWatching();
      };
      const watcher = watch(stateDir, signalIfWritten);
      const poll = setInterval(signalIfWritten, 100);

      // Spawned in the same tick as the watch is set up, so no callback can
      // run before `bridge` is assigned.
      const bridge = spawnTracked(process.execPath, [CLI]);
      bridge.child.once("exit", stopWatching);

      expect(await exited(bridge.child)).toBe(0);
      expect(signalled).toBe(true);
      expect(await exists(statePath)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "npm run bridge on a taken port prints one stderr line naming the port and bridge:status, with no stack trace or npm error, and exits non-zero",
    async () => {
      const holder = createServer();
      servers.push(holder);
      await new Promise<void>((done) =>
        holder.listen(0, "127.0.0.1", () => done()),
      );
      const address = holder.address();
      if (address === null || typeof address === "string")
        throw new Error("no port");
      env.BRIDGE_PORT = String(address.port);

      const run = spawnTracked("npm", ["run", "bridge"]);
      const code = await exited(run.child);

      expect(code).not.toBe(0);
      expect(code).not.toBeNull();
      const lines = run
        .stderr()
        .split("\n")
        .filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(String(address.port));
      expect(lines[0]).toContain("bridge:status");
      const all = run.stdout() + run.stderr();
      expect(all).not.toMatch(/^\s+at /m);
      expect(all).not.toContain("npm error");
    },
    TIMEOUT,
  );
});

const PROJECT_VARIABLES = new Set([
  "TTRPG_AGENTS_DB",
  "BRIDGE_PORT",
  "BRIDGE_AGENT_TOKEN_FILE",
  "BRIDGE_STATE_FILE",
  "BRIDGE_STATIC_DIR",
  "TTRPG_AGENTS_BACKUP_DIR",
]);

/**
 * Points `env` at a temp HOME and XDG config directory with no project or
 * other XDG variables, so only config.json (or the defaults under the temp
 * directories) can name the database and port. Returns the config.json writer.
 */
async function isolateSettings(): Promise<(content: unknown) => Promise<void>> {
  const home = join(dir, "home");
  const configHome = join(dir, "xdg-config");
  await mkdir(home);
  await mkdir(configHome);
  const isolated: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (PROJECT_VARIABLES.has(name) || name.startsWith("XDG_")) continue;
    isolated[name] = value;
  }
  isolated.HOME = home;
  isolated.XDG_CONFIG_HOME = configHome;
  // config.json goes in the default profile's directory, whatever the checkout.
  isolated.TTRPG_AGENTS_PROFILE = "default";
  env = isolated;
  return async (content) => {
    const configDir = join(configHome, "ttrpg-agents");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.json"), JSON.stringify(content));
  };
}

/** A loopback port nothing listens on. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/**
 * The port from the listening line, or the exit code if the bridge exits
 * first; at the deadline the bridge is killed and neither is set.
 */
async function listeningOrExit(
  spawned: Spawned,
  deadlineMs = 15_000,
): Promise<{ port?: number; code?: number | null }> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const m = /bridge listening on http:\/\/localhost:(\d+)/.exec(
      spawned.stdout(),
    );
    if (m) return { port: Number(m[1]) };
    if (spawned.child.exitCode !== null || spawned.child.signalCode !== null)
      return { code: spawned.child.exitCode };
    if (Date.now() > deadline) {
      await stopChild(spawned.child);
      return {};
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Exit code, or null when the bridge was still running at the deadline and was killed. */
async function exitWithin(
  spawned: Spawned,
  deadlineMs = 15_000,
): Promise<number | null> {
  const timer = setTimeout(() => spawned.child.kill("SIGKILL"), deadlineMs);
  try {
    return await exited(spawned.child);
  } finally {
    clearTimeout(timer);
  }
}

type Snapshot = Extract<BridgeMessage, { type: "encounter-snapshot" }>;

/** Connects as a page the bridge served, says hello and returns the first snapshot. */
async function firstSnapshot(port: number): Promise<Snapshot> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
    origin: `http://localhost:${String(port)}`,
  });
  try {
    return await new Promise<Snapshot>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error("no snapshot after hello")),
        10_000,
      );
      ws.once("error", fail);
      ws.on("message", (data: Buffer) => {
        const r = decodeMessage(data.toString());
        if (r.ok && r.message.type === "encounter-snapshot") {
          clearTimeout(timer);
          done(r.message);
        }
      });
      ws.once("open", () =>
        ws.send(
          encodeMessage({
            v: PROTOCOL_VERSION,
            type: "hello",
            id: "h1",
            payload: { role: "gm", extensionVersion: "0" },
          }),
        ),
      );
    });
  } finally {
    ws.close();
  }
}

describe("bridge CLI settings", () => {
  it(
    "the bridge spawned with no project environment variables listens on the port config.json names and serves the encounter in the database it names",
    async () => {
      const writeConfig = await isolateSettings();
      const port = await freePort();
      const database = join(dir, "configured", "encounters.db");
      const db = openDatabase(database);
      try {
        const encounters = new SqliteEncounterDirectory(db);
        encounters.repositoryFor(resolveEncounter(encounters).id).addInstances(
          () => [
            {
              monsterKey: "srd-2024_shadow",
              displayName: "Configured Shadow",
              maxHp: 16,
            },
          ],
          { source: "mcp", commandId: "seed" },
        );
      } finally {
        db.close();
      }
      await writeConfig({ database, bridgePort: port });

      const bridge = spawnTracked(process.execPath, [CLI]);
      const started = await listeningOrExit(bridge);

      expect(started, bridge.stderr()).toEqual({ port });
      const snapshot = await firstSnapshot(port);
      expect(snapshot.payload.instances.map((i) => i.displayName)).toEqual([
        "Configured Shadow",
      ]);
    },
    TIMEOUT,
  );

  it(
    "the bridge exits 1 with a stderr line naming bridgePort when config.json has an invalid bridgePort",
    async () => {
      const writeConfig = await isolateSettings();
      await writeConfig({ bridgePort: "abc" });

      const bridge = spawnTracked(process.execPath, [CLI]);
      const code = await exitWithin(bridge);

      expect(code, bridge.stderr()).toBe(1);
      expect(bridge.stderr()).toMatch(/^.*bridgePort.*$/m);
    },
    TIMEOUT,
  );

  it(
    "the bridge started with TTRPG_AGENTS_PROFILE=dev prints its profile and why with its start lines",
    async () => {
      const home = join(dir, "home");
      const configHome = join(dir, "xdg-config");
      const dataHome = join(dir, "xdg-data");
      await mkdir(home);
      await mkdir(configHome);
      await mkdir(dataHome);
      env.HOME = home;
      env.XDG_CONFIG_HOME = configHome;
      env.XDG_DATA_HOME = dataHome;
      env.TTRPG_AGENTS_PROFILE = "dev";

      const bridge = spawnTracked(process.execPath, [CLI]);
      await listeningPort(bridge);
      await waitFor(
        () =>
          Promise.resolve(
            /^install in Owlbear: /m.test(bridge.stdout()) ? true : undefined,
          ),
        "the install line",
      );

      const lines = bridge.stdout().split("\n");
      const listening = lines.findIndex((line) =>
        line.startsWith("bridge listening on "),
      );
      expect(listening).toBeGreaterThanOrEqual(0);
      expect(lines[listening + 1]).toBe("profile: dev (TTRPG_AGENTS_PROFILE)");
    },
    TIMEOUT,
  );
});
