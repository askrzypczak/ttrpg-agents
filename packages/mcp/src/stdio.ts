#!/usr/bin/env node
import { randomInt } from "node:crypto";
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSrdMonsters, type Rng } from "@ttrpg-agents/core";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { createServer } from "./server.js";

const rng: Rng = { nextInt: (maxExclusive) => randomInt(maxExclusive) };

async function main(): Promise<void> {
  const server = createServer({
    repo: new SqliteEncounterRepository(openDatabase()),
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date(),
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
