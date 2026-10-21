import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolAnnotations } from "./tools.js";

const entry = fileURLToPath(new URL("../bin/stdio.mjs", import.meta.url));

const expectedAnnotations: Record<string, ToolAnnotations | undefined> = {
  search_monsters: { readOnlyHint: true },
  get_statblock: { readOnlyHint: true },
  list_encounter: { readOnlyHint: true },
  add_monsters: { destructiveHint: false },
  remove_monsters: { destructiveHint: true },
  clear_encounter: { destructiveHint: true },
  apply_damage: undefined,
  heal: undefined,
};

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function connect(): Promise<Client> {
  const dir = mkdtempSync(join(tmpdir(), "ttrpg-mcp-"));
  cleanup.push(() => {
    rmSync(dir, { recursive: true, force: true });
    return Promise.resolve();
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, TTRPG_AGENTS_DB: join(dir, "test.db") },
  });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  return client;
}

describe("stdio server", () => {
  it("lists all eight tools and serves a call", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_monsters",
      "apply_damage",
      "clear_encounter",
      "get_statblock",
      "heal",
      "list_encounter",
      "remove_monsters",
      "search_monsters",
    ]);

    const added = await client.callTool({
      name: "add_monsters",
      arguments: { groups: [{ monster: "srd-2024_shadow", count: 2 }] },
    });
    expect(added.isError).toBeFalsy();
    const listed = await client.callTool({ name: "list_encounter" });
    expect(JSON.stringify(listed.content)).toContain("Shadow 2");
  }, 30_000);

  it("listTools carries each tool's annotations", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      Object.keys(expectedAnnotations).sort(),
    );
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual(
        expectedAnnotations[tool.name],
      );
    }
  }, 30_000);
});
