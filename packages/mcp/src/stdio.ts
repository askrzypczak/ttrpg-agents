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
import { createMonsterIndex, type Rng } from "@ttrpg-agents/engine";
import {
  createNodeImageSource,
  createSharpTokeniser,
} from "@ttrpg-agents/imaging";
import { loadSrdMonsters, loadTooManyTokensIndex } from "@ttrpg-agents/srd";
import {
  SqliteCreatureRepository,
  SqliteEncounterDirectory,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
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
  const creatures = new SqliteCreatureRepository(db);
  const client = createBridgeClient({
    port: settings.bridgePort,
    tokenPath: settings.agentTokenFile,
  });
  const tokeniser = createSharpTokeniser();
  const server = createServer({
    table: createBridgeTable(client),
    browser: createSystemBrowser(),
    encounters: new SqliteEncounterDirectory(db),
    monsters: createMonsterIndex(loadSrdMonsters(), creatures),
    creatures,
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
      database: createDatabaseProbe(settings.database, settings.backupDir),
      bridge: createBridgeProbe({
        client,
        port: settings.bridgePort,
        tokenPath: settings.agentTokenFile,
      }),
      now: () => new Date(),
      tokeniser,
    },
    tokeniser,
    imageSource: createNodeImageSource(),
    art: new SqliteTokenArtRepository(db),
    images: new SqliteTokenImageRepository(db),
    tooManyTokens: loadTooManyTokensIndex(),
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
