import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `node scripts/bridge.ts` as a child process, run from the repo root with a
// temp HOME and XDG config directory and no project environment variables.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;

const PROJECT_VARIABLES = new Set([
  "TTRPG_AGENTS_DB",
  "BRIDGE_PORT",
  "BRIDGE_AGENT_TOKEN_FILE",
  "BRIDGE_STATE_FILE",
  "BRIDGE_STATIC_DIR",
]);

let dir: string;
let configHome: string;
let env: NodeJS.ProcessEnv;
const children: ChildProcess[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-script-"));
  const home = join(dir, "home");
  configHome = join(dir, "xdg-config");
  await mkdir(home);
  await mkdir(configHome);
  env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (PROJECT_VARIABLES.has(name) || name.startsWith("XDG_")) continue;
    env[name] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = configHome;
  // config.json goes in the default profile's directory, whatever the checkout.
  env.TTRPG_AGENTS_PROFILE = "default";
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(content: unknown): Promise<void> {
  const configDir = join(configHome, "ttrpg-agents");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.json"), JSON.stringify(content));
}

/** Runs the script; kills it if it is still running at the deadline (code null). */
function runScript(
  args: string[],
  deadlineMs = 20_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["scripts/bridge.ts", ...args], {
    cwd: REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  return new Promise((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

describe("bridge script settings", () => {
  it(
    "bridge:status exits 1 with a stderr line naming bridgePort when config.json has an invalid bridgePort",
    async () => {
      await writeConfig({ bridgePort: "abc" });

      const result = await runScript(["status"]);

      expect(result.code, result.stderr).toBe(1);
      expect(result.stderr).toMatch(/^.*bridgePort.*$/m);
    },
    TIMEOUT,
  );

  it(
    "bridge:status with TTRPG_AGENTS_PROFILE=dev prints the profile and why",
    async () => {
      const dataHome = join(dir, "xdg-data");
      await mkdir(dataHome);
      env.XDG_DATA_HOME = dataHome;
      env.TTRPG_AGENTS_PROFILE = "dev";
      // Port 0: status probes no fixed port.
      env.BRIDGE_PORT = "0";

      const result = await runScript(["status"]);

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.split("\n")[0]).toBe(
        "profile: dev (TTRPG_AGENTS_PROFILE)",
      );
    },
    TIMEOUT,
  );
});
