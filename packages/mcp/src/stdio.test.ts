import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../dist/stdio.js", import.meta.url));

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

describe("stdio server", () => {
  it("lists all eight tools and serves a call", async () => {
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
});
