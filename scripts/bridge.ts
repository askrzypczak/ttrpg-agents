// `npm run bridge:start|stop|restart|status`: runs the bridge detached from the
// terminal and reports on it. The logic lives in bridge-lifecycle.ts; this
// entry wires the settings from the config (docs/settings.md), this checkout
// and the real build.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bridgeStatus,
  restartBridge,
  startBridge,
  stopBridge,
  type LifecycleOptions,
} from "./bridge-lifecycle.ts";
import { loadConfig } from "../packages/config/src/config.ts";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `npm run build` in this checkout, output to the terminal. */
function build(): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: checkout,
      stdio: "inherit",
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (code === 0) done();
      else
        fail(
          new Error(
            `npm run build exited with ${code !== null ? `code ${String(code)}` : `signal ${String(signal)}`}`,
          ),
        );
    });
  });
}

const commands: Record<string, (options: LifecycleOptions) => Promise<number>> =
  {
    start: startBridge,
    stop: stopBridge,
    restart: restartBridge,
    status: bridgeStatus,
  };

const name = process.argv[2] ?? "";
const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
if (command === undefined) {
  console.error("usage: node scripts/bridge.ts <start|stop|restart|status>");
  process.exitCode = 2;
} else {
  const { settings, problems } = loadConfig({
    env: process.env,
    home: homedir(),
    checkout,
  });
  for (const problem of problems) console.error(problem.message);
  if (problems.some((p) => p.level === "error")) process.exit(1);
  process.exitCode = await command({
    statePath: settings.bridgeStateFile,
    port: settings.bridgePort,
    agentTokenPath: settings.agentTokenFile,
    checkout,
    env: process.env,
    build,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}
