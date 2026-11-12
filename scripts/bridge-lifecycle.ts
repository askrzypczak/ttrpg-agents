// The logic behind `npm run bridge:start|stop|restart|status` (entry:
// bridge.ts). Runs under Node type stripping, so it imports the bridge's
// state-file module by source path; it uses only Node built-ins.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, fchmodSync, mkdirSync, openSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import {
  checkoutCommit,
  readStateFile,
  removeStateFile,
  type BridgeState,
} from "../packages/bridge/src/state-file.ts";

export interface LifecycleOptions {
  statePath: string; // the log is bridge.log beside it
  port: number; // status probes it when no live bridge is recorded
  agentTokenPath: string; // status reads it for the GM tab line
  checkout: string; // the checkout the command runs from
  profile: string; // describeProfile's text; bridgeStatus prints `profile: <text>` first
  env: NodeJS.ProcessEnv; // passed to the spawned bridge only (BRIDGE_STATE_FILE forced to statePath)
  build: () => Promise<void>; // throws on failure
  out: (line: string) => void;
  err: (line: string) => void;
}

const POLL_MS = 100;
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 6_000;
const PROBE_TIMEOUT_MS = 1_000;
/** How far the recorded start time may be from the one `ps` implies. */
const START_TIME_TOLERANCE_MS = 3_000;
const LOG_TAIL_LINES = 20;

function logPathFor(statePath: string): string {
  return join(dirname(statePath), "bridge.log");
}

function cliPath(checkout: string): string {
  return join(checkout, "packages", "bridge", "dist", "cli.js");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `ps` etime (`[[dd-]hh:]mm:ss`) in whole seconds, or null. */
function parseEtime(etime: string): number | null {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!m) return null;
  const [, days, hours, minutes, seconds] = m;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds)
  );
}

interface PsLine {
  /** Bounds on the process start time (epoch ms) that `ps` implies. */
  earliestStart: number;
  latestStart: number;
  args: string;
}

function psLine(pid: number): PsLine | null {
  const before = Date.now();
  let ps;
  try {
    // Separate -o options: BSD and POSIX ps read everything after `=` as the
    // column header, so `etime=,args=` would be a single column on macOS.
    ps = spawnSync("ps", ["-o", "etime=", "-o", "args=", "-p", String(pid)], {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  const after = Date.now();
  if (ps.error || ps.status !== 0) return null;
  const m = /^\s*(\S+)\s+(.*)$/.exec(ps.stdout.trim());
  if (!m) return null;
  const elapsed = parseEtime(m[1] ?? "");
  if (elapsed === null) return null;
  // ps read the elapsed time at some moment between `before` and `after`, and
  // truncated it to whole seconds.
  return {
    earliestStart: before - (elapsed + 1) * 1_000,
    latestStart: after - elapsed * 1_000,
    args: m[2] ?? "",
  };
}

/**
 * Whether `record` describes a live bridge: the pid exists, runs `cli.js`, is
 * not a zombie, and started when the record says. Any doubt means no, so a
 * reused pid is never signalled.
 */
function isRecordedBridge(record: BridgeState): boolean {
  if (!alive(record.pid)) return false;
  const ps = psLine(record.pid);
  if (ps === null) return false;
  if (!ps.args.includes("cli.js") || ps.args.includes("<defunct>"))
    return false;
  const startedAt = Date.parse(record.startedAt);
  if (Number.isNaN(startedAt)) return false;
  return (
    startedAt >= ps.earliestStart - START_TIME_TOLERANCE_MS &&
    startedAt <= ps.latestStart + START_TIME_TOLERANCE_MS
  );
}

function printRecord(record: BridgeState, out: (line: string) => void): void {
  out(`pid: ${String(record.pid)}`);
  out(`port: ${String(record.port)}`);
  out(`url: http://localhost:${String(record.port)}`);
  out(`checkout: ${record.checkout}`);
  out(`commit: ${record.commit ?? "unknown"}`);
  out(`started: ${record.startedAt}`);
}

async function logTail(path: string): Promise<string[]> {
  try {
    const lines = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");
    return lines.slice(-LOG_TAIL_LINES);
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startBridge(options: LifecycleOptions): Promise<number> {
  const { statePath, checkout, env, out, err } = options;
  const logPath = logPathFor(statePath);
  const existing = await readStateFile(statePath);
  if (existing !== null && isRecordedBridge(existing)) {
    err(`bridge: already running (pid ${String(existing.pid)})`);
    printRecord(existing, err);
    err("Run `npm run bridge:restart` to replace it.");
    return 1;
  }
  if (existing !== null) await removeStateFile(statePath, existing.pid);

  try {
    await options.build();
  } catch (error) {
    err(`bridge: build failed, no bridge started: ${message(error)}`);
    return 1;
  }

  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const log = openSync(logPath, "w", 0o600);
  let child;
  try {
    fchmodSync(log, 0o600);
    child = spawn(process.execPath, [cliPath(checkout)], {
      cwd: checkout,
      detached: true,
      env: { ...env, BRIDGE_STATE_FILE: statePath },
      stdio: ["ignore", log, log],
    });
  } finally {
    closeSync(log);
  }
  child.unref();
  const pid = child.pid;
  const seen: {
    exit: { code: number | null; signal: NodeJS.Signals | null } | null;
    error: Error | null;
  } = { exit: null, error: null };
  child.once("exit", (code, signal) => (seen.exit = { code, signal }));
  child.once("error", (error) => (seen.error = error));

  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    if (seen.error !== null || pid === undefined) {
      err(
        `bridge: could not start ${cliPath(checkout)}: ${message(seen.error)}`,
      );
      return 1;
    }
    const record = await readStateFile(statePath);
    if (record?.pid === pid) {
      out(`bridge: started (pid ${String(pid)})`);
      out(`port: ${String(record.port)}`);
      out(`url: http://localhost:${String(record.port)}`);
      out(`log: ${logPath} (holds the install URL)`);
      return 0;
    }
    if (seen.exit !== null) {
      const { code, signal } = seen.exit;
      err(
        `bridge: exited before listening (${code !== null ? `exit code ${String(code)}` : `signal ${String(signal)}`}); last lines of ${logPath}:`,
      );
      for (const line of await logTail(logPath)) err(line);
      return 1;
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      const exitBy = Date.now() + STOP_TIMEOUT_MS;
      while (seen.exit === null && Date.now() < exitBy) await sleep(POLL_MS);
      err(
        `bridge: not listening after ${String(START_TIMEOUT_MS / 1_000)} s, stopped pid ${String(pid)}; see ${logPath}`,
      );
      return 1;
    }
    await sleep(POLL_MS);
  }
}

export async function stopBridge(options: LifecycleOptions): Promise<number> {
  const { statePath, out, err } = options;
  const record = await readStateFile(statePath);
  if (record === null) {
    out("bridge: no bridge is running");
    return 0;
  }
  if (!isRecordedBridge(record)) {
    await removeStateFile(statePath, record.pid);
    out(
      `bridge: no bridge is running (removed a stale state file for pid ${String(record.pid)})`,
    );
    return 0;
  }

  const { pid } = record;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    err(`bridge: could not signal pid ${String(pid)}: ${message(error)}`);
    return 1;
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  // Polled with timers, not a synchronous sleep, so that when the bridge is
  // this process's child its exit is reaped and the pid disappears.
  while (alive(pid)) {
    if (Date.now() > deadline) {
      err(
        `bridge: pid ${String(pid)} is still running ${String(STOP_TIMEOUT_MS / 1_000)} s after SIGTERM`,
      );
      return 1;
    }
    await sleep(POLL_MS);
  }
  await removeStateFile(statePath, pid);
  out(`bridge: stopped (pid ${String(pid)})`);
  return 0;
}

export async function restartBridge(
  options: LifecycleOptions,
): Promise<number> {
  const stopped = await stopBridge(options);
  if (stopped !== 0) return stopped;
  return startBridge(options);
}

async function samePath(a: string, b: string): Promise<boolean> {
  const real = (p: string): Promise<string> =>
    realpath(p).catch(() => resolve(p));
  return (await real(a)) === (await real(b));
}

async function gmTab(record: BridgeState, tokenPath: string): Promise<string> {
  let token: string;
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch (error) {
    return `unknown (cannot read the agent token file ${tokenPath}: ${(error as NodeJS.ErrnoException).code ?? "read failed"})`;
  }
  // Checked before it goes into a header: fetch's error for an invalid header
  // value quotes the value.
  if (!/^[\x21-\x7e]+$/.test(token))
    return `unknown (the agent token file ${tokenPath} does not hold a valid token)`;
  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:${String(record.port)}/agent/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: "scene-status" }),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const reason = message(error).split(token).join("<agent token>");
    return `unknown (the scene-status query failed: ${reason})`;
  }
  const code = await response
    .json()
    .then((body: unknown) => {
      const error = (body as { error?: { code?: unknown } } | null)?.error;
      return typeof error?.code === "string" ? error.code : null;
    })
    .catch(() => null);
  if (response.status === 200) return "connected";
  if (response.status === 502 || response.status === 504)
    return `connected, but its answer failed: ${code ?? String(response.status)}`;
  if (response.status === 503) return "not connected";
  if (response.status === 401)
    return `unknown (the bridge refused the agent token from ${tokenPath})`;
  return `unknown (the scene-status query returned HTTP ${String(response.status)})`;
}

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(port, "127.0.0.1");
    const finish = (result: boolean): void => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function probePort(record: BridgeState | null, configured: number): number {
  return record !== null ? record.port : configured;
}

export async function bridgeStatus(options: LifecycleOptions): Promise<number> {
  const { statePath, checkout, out } = options;
  const logPath = logPathFor(statePath);
  const record = await readStateFile(statePath);

  if (record !== null && isRecordedBridge(record)) {
    out("bridge: running");
    printRecord(record, out);
    out(`log: ${logPath}`);
    if (!(await samePath(record.checkout, checkout)))
      out(
        `warning: the running bridge is from checkout ${record.checkout}, not this checkout (${checkout})`,
      );
    const here = checkoutCommit(checkout);
    if (record.commit !== here)
      out(
        `warning: the running bridge's commit ${record.commit ?? "unknown"} differs from this checkout's ${here ?? "unknown"}`,
      );
    out(`GM tab: ${await gmTab(record, options.agentTokenPath)}`);
    return 0;
  }

  out(
    record === null
      ? "bridge: not running"
      : `bridge: not running (stale state file for pid ${String(record.pid)})`,
  );
  out(`log: ${logPath}`);
  const port = probePort(record, options.port);
  if (
    Number.isInteger(port) &&
    port > 0 &&
    port < 65_536 &&
    (await accepts(port))
  )
    out(
      `port ${String(port)} accepts connections: another process holds it (a bridge started without a state file, or another program)`,
    );
  return 0;
}
