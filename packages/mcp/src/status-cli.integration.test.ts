import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const statusLauncher = fileURLToPath(
  new URL("../bin/status.mjs", import.meta.url),
);
const stdioLauncher = fileURLToPath(
  new URL("../bin/stdio.mjs", import.meta.url),
);

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A loopback port with nothing listening on it. */
async function unusedPort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const PROJECT_VARIABLES = new Set([
  "TTRPG_AGENTS_DB",
  "BRIDGE_PORT",
  "BRIDGE_AGENT_TOKEN_FILE",
  "BRIDGE_STATE_FILE",
  "BRIDGE_STATIC_DIR",
  "TTRPG_AGENTS_PROFILE",
]);

interface Isolated {
  env: Record<string, string>;
  /** The default profile's config directory under the temp XDG config home. */
  configDir: string;
  /** Where the default profile's database would be. */
  database: string;
  writeConfig: (content: unknown) => void;
  writeToken: (token: string) => void;
}

/**
 * A temp HOME and XDG config and data directories, and a child environment
 * with no project variables and no other XDG variables, pinned to the default
 * profile so config.json is found whatever the checkout.
 */
function isolated(): Isolated {
  const root = mkdtempSync(join(tmpdir(), "ttrpg-status-"));
  cleanup.push(() => {
    rmSync(root, { recursive: true, force: true });
    return Promise.resolve();
  });
  const home = join(root, "home");
  const configHome = join(root, "config");
  const dataHome = join(root, "data");
  mkdirSync(home);
  mkdirSync(configHome);
  mkdirSync(dataHome);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || PROJECT_VARIABLES.has(name)) continue;
    if (name.startsWith("XDG_")) continue;
    env[name] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = configHome;
  env.XDG_DATA_HOME = dataHome;
  env.TTRPG_AGENTS_PROFILE = "default";
  const configDir = join(configHome, "ttrpg-agents");
  return {
    env,
    configDir,
    database: join(dataHome, "ttrpg-agents", "encounters.db"),
    writeConfig(content) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify(content));
    },
    writeToken(token) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "agent-token"), `${token}\n`, {
        mode: 0o600,
      });
    },
  };
}

/**
 * A stand-in bridge on a loopback port: `POST /agent/query` with the bearer
 * `token` gets a scene-status from a tab in `roomId`; any other token gets
 * the bridge's 401 unauthorized answer.
 */
async function fakeBridge(
  token: string,
  roomId = "room-fake",
): Promise<number> {
  const server = createHttpServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST" || req.url !== "/agent/query") {
          res.statusCode = 404;
          res.end("{}");
          return;
        }
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "unauthorized",
                message: "missing or invalid agent token",
              },
            }),
          );
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            result: {
              name: "scene-status",
              result: {
                sceneReady: true,
                tokenCount: 0,
                appliedInstanceCount: 0,
                artWaits: [],
                roomId,
              },
            },
          }),
        );
      });
    },
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

interface Finished {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `npm run status`'s launcher; kills it if it is still running at the deadline. */
function runStatus(
  env: Record<string, string>,
  deadlineMs = 15_000,
): Promise<Finished> {
  const child = spawn(process.execPath, [statusLauncher], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    return Promise.resolve();
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The report without the final newline the CLI ends its output with. */
function reportOf(stdout: string): string {
  return stdout.replace(/\n$/, "");
}

/** Asserts `row` is a line of `text` and the next line is `fix`. */
function expectRowWithFix(text: string, row: string, fix: string): void {
  const lines = text.split("\n");
  const at = lines.indexOf(row);
  expect(at, `${row}\n--- in ---\n${text}`).toBeGreaterThan(-1);
  expect(lines[at + 1], row).toBe(`  fix: ${fix}`);
}

describe("npm run status", () => {
  it("with the MCP server started first (so the database exists at this build's version) and the same environment, npm run status prints exactly the text its setup_status tool replies", async () => {
    const setup = isolated();
    const token = "parity-token-5b1e";
    setup.writeToken(token);
    setup.env.BRIDGE_PORT = String(await fakeBridge(token, "room-parity"));

    const client = new Client({ name: "status-parity", version: "0.0.0" });
    cleanup.push(() => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [stdioLauncher],
        env: setup.env,
      }),
    );
    const reply = await client.callTool({ name: "setup_status" });
    expect(reply.isError).toBeFalsy();
    const content = reply.content as { type: string; text?: string }[];
    const toolText = content.map((c) => c.text ?? "").join("\n");

    const result = await runStatus(setup.env);

    expect(result.code, result.stderr).toBe(0);
    expect(reportOf(result.stdout)).toBe(toolText);
    expect(toolText.split("\n")[0]).toBe("Setup: ready.");
  }, 60_000);

  it("npm run status with nothing set up exits 0, reports the missing database and bridge with start-bridge fixes, and creates no database", async () => {
    const setup = isolated();
    const port = await unusedPort();
    setup.env.BRIDGE_PORT = String(port);

    const result = await runStatus(setup.env);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const text = reportOf(result.stdout);
    expect(text.split("\n")[0]).toBe("Setup: not ready.");
    const startBridge = "start the bridge: npm run bridge:start";
    expectRowWithFix(
      text,
      `problem: database ${setup.database}: not found`,
      startBridge,
    );
    expectRowWithFix(
      text,
      `problem: bridge on port ${String(port)}: never started in this profile (no agent token file at ${join(setup.configDir, "agent-token")})`,
      startBridge,
    );
    expect(existsSync(setup.database), "no database file").toBe(false);
    expect(
      existsSync(join(setup.database, "..")),
      "no database directory",
    ).toBe(false);
  }, 30_000);

  it("npm run status exits 0 and prints a fix-config row naming bridgePort when config.json has an invalid bridgePort", async () => {
    const setup = isolated();
    setup.writeConfig({ bridgePort: "abc" });
    const configPath = join(setup.configDir, "config.json");

    const result = await runStatus(setup.env);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const text = reportOf(result.stdout);
    expect(text.split("\n")[0]).toBe("Setup: not ready.");
    const lines = text.split("\n");
    const at = lines.findIndex(
      (l) => l.startsWith("problem: ") && l.includes('"bridgePort"'),
    );
    expect(at, text).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(
      `  fix: correct "bridgePort" in ${configPath} (see docs/settings.md)`,
    );
  }, 30_000);

  it("npm run status never prints the agent token, whether the bridge accepts or refuses it", async () => {
    const token = "status-secret-token-91d7c4";

    const accepted = isolated();
    accepted.writeToken(token);
    const acceptingPort = await fakeBridge(token);
    accepted.env.BRIDGE_PORT = String(acceptingPort);
    const ok = await runStatus(accepted.env);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stdout).toContain(
      `ok: bridge on port ${String(acceptingPort)}: reached`,
    );
    expect(ok.stdout).not.toContain(token);
    expect(ok.stderr).not.toContain(token);

    const refused = isolated();
    refused.writeToken(token);
    const refusingPort = await fakeBridge("another-profile-token");
    refused.env.BRIDGE_PORT = String(refusingPort);
    const no = await runStatus(refused.env);
    expect(no.code, no.stderr).toBe(0);
    expect(no.stdout).toContain(
      `problem: bridge on port ${String(refusingPort)}: refused this profile's agent token`,
    );
    expect(no.stdout).not.toContain(token);
    expect(no.stderr).not.toContain(token);
  }, 30_000);

  it("the status launcher prints the build hint to stderr, nothing to stdout, and exits 1 when dist/status-cli.js is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-status-launcher-"));
    cleanup.push(() => {
      rmSync(dir, { recursive: true, force: true });
      return Promise.resolve();
    });
    mkdirSync(join(dir, "bin"));
    const copy = join(dir, "bin", "status.mjs");
    copyFileSync(statusLauncher, copy);

    const result = spawnSync(process.execPath, [copy], {
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "ttrpg-agents status: run `npm run build` first\n",
    );
    expect(result.stdout).toBe("");
  });
});
