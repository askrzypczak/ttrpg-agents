#!/usr/bin/env node
import { randomInt, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createBridgeClient,
  createBridgeProbe,
  createBridgeTable,
} from "@ttrpg-agents/bridge/client";
import { SETTINGS, describeProfile, loadConfig } from "@ttrpg-agents/config";
import type { Rng } from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  createDatabaseProbe,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { createServer } from "./server.js";
import { createSystemBrowser } from "./system-browser.js";

const rng: Rng = { nextInt: (maxExclusive) => randomInt(maxExclusive) };

async function main(): Promise<void> {
  const loaded = loadConfig({
    env: process.env,
    home: homedir(),
    checkout: resolve(fileURLToPath(new URL("../../..", import.meta.url))),
  });
  const { settings, problems } = loaded;
  for (const problem of problems) process.stderr.write(`${problem.message}\n`);
  if (problems.some((p) => p.level === "error")) {
    process.exitCode = 1;
    return;
  }
  const db = openDatabase(settings.database);
  const client = createBridgeClient({
    port: settings.bridgePort,
    tokenPath: settings.agentTokenFile,
  });
  const server = createServer({
    table: createBridgeTable(client),
    browser: createSystemBrowser(),
    repo: new SqliteEncounterRepository(db),
    maps: new SqliteMapRepository(db),
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date(),
    newGroupId: randomUUID,
    newCommandId: randomUUID,
    setup: {
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
    },
  });
  await server.connect(new StdioServerTransport());
}

// stdout carries the protocol; log to stderr only.
main().catch((e: unknown) => {
  process.stderr.write(
    `${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exit(1);
});
