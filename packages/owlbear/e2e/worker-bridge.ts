import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { e2eDbPath, seedE2eDatabase } from "./db.js";
import {
  E2E_AGENT_TOKEN,
  E2E_TOKEN,
  writeE2eAgentTokenFile,
  writeE2eTokenFile,
} from "./token.js";

/** A real bridge child process owned by one Playwright worker. */
export interface WorkerBridge {
  origin: string;
  token: string;
  /** Bearer token for `POST /agent/command`. */
  agentToken: string;
  stop(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 15_000;
const LISTENING = /bridge listening on (http:\/\/localhost:\d+)/;

/**
 * Starts the real bridge CLI (`packages/bridge/dist/cli.js`, cwd `repo`) on an
 * ephemeral port, serving `staticDir`, with its token file and seeded DB in
 * `dir`. Resolves once the bridge reports its listening origin.
 */
export async function startWorkerBridge(options: {
  repo: string;
  staticDir: string;
  dir: string;
}): Promise<WorkerBridge> {
  const { repo, staticDir, dir } = options;
  const tokenFile = writeE2eTokenFile(dir);
  const agentTokenFile = writeE2eAgentTokenFile(dir);
  seedE2eDatabase(dir);

  const child = spawn(
    process.execPath,
    [join(repo, "packages/bridge/dist/cli.js")],
    {
      cwd: repo,
      env: {
        ...process.env,
        BRIDGE_PORT: "0",
        BRIDGE_STATIC_DIR: staticDir,
        BRIDGE_TOKEN_FILE: tokenFile,
        BRIDGE_AGENT_TOKEN_FILE: agentTokenFile,
        TTRPG_AGENTS_DB: e2eDbPath(dir),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await exited;
  };

  let origin: string;
  try {
    origin = await waitForOrigin(child);
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, token: E2E_TOKEN, agentToken: E2E_AGENT_TOKEN, stop };
}

function waitForOrigin(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("close", onClose);
      child.off("error", onError);
      settle();
    };
    const onStdout = (chunk: Buffer) => {
      output += chunk.toString();
      const match = LISTENING.exec(output);
      if (match) finish(() => resolve(match[1]!));
    };
    const onStderr = (chunk: Buffer) => {
      output += chunk.toString();
    };
    const onClose = (code: number | null, signal: string | null) =>
      finish(() =>
        reject(
          new Error(
            `bridge exited before listening (code ${code}, signal ${signal}):\n${output}`,
          ),
        ),
      );
    const onError = (error: Error) => finish(() => reject(error));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `bridge did not start within ${STARTUP_TIMEOUT_MS}ms:\n${output}`,
            ),
          ),
        ),
      STARTUP_TIMEOUT_MS,
    );
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("close", onClose);
    child.once("error", onError);
  });
}
