#!/usr/bin/env node
// Composition root for `npm run status`: prints the setup report and exits 0
// whatever the verdict. Config errors are rows of the report, not a stop; only
// an unexpected crash writes to stderr and exits 1.
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createBridgeClient,
  createBridgeProbe,
} from "@ttrpg-agents/bridge/client";
import { SETTINGS, describeProfile, loadConfig } from "@ttrpg-agents/config";
import { getSetupStatus } from "@ttrpg-agents/engine";
import { createDatabaseProbe } from "@ttrpg-agents/store-sqlite";
import { formatSetupStatus } from "./setup-status.js";

async function main(): Promise<void> {
  const loaded = loadConfig({
    env: process.env,
    home: homedir(),
    checkout: resolve(fileURLToPath(new URL("../../..", import.meta.url))),
  });
  const { settings } = loaded;
  const client = createBridgeClient({
    port: settings.bridgePort,
    tokenPath: settings.agentTokenFile,
  });
  const status = await getSetupStatus({
    settings: {
      profile: describeProfile(loaded.profile),
      configFile: loaded.configFile,
      problems: loaded.problems,
      settings: SETTINGS.map(({ name }) => ({
        name,
        value: loaded.settings[name],
        source: loaded.sources[name],
      })),
    },
    database: createDatabaseProbe(settings.database),
    bridge: createBridgeProbe({
      client,
      port: settings.bridgePort,
      tokenPath: settings.agentTokenFile,
    }),
  });
  process.stdout.write(`${formatSetupStatus(status)}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(
    `${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exitCode = 1;
});
