import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
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
  preview_monsters: { readOnlyHint: true },
  move_monsters: { destructiveHint: true },
  remove_monsters: { destructiveHint: true },
  restore_monsters: { destructiveHint: false },
  rename_monster: { destructiveHint: true },
  change_monster_type: { destructiveHint: true },
  set_initiative: { destructiveHint: true },
  roll_initiative: { destructiveHint: true },
  split_initiative: { destructiveHint: true },
  merge_initiative: { destructiveHint: true },
  set_hp: { destructiveHint: true },
  set_max_hp: { destructiveHint: true },
  reset_max_hp: { destructiveHint: true },
  set_armor_class: { destructiveHint: true },
  set_stats_visibility: { destructiveHint: false },
  clear_encounter: { destructiveHint: true },
  restore_encounter: { destructiveHint: false },
  undo: { destructiveHint: true },
  apply_damage: undefined,
  heal: undefined,
  table_status: { readOnlyHint: true },
  use_map: { destructiveHint: false },
  set_rooms: { destructiveHint: true },
  list_rooms: { readOnlyHint: true },
  remove_rooms: { destructiveHint: true },
  get_map_image: { readOnlyHint: true },
  propose_rooms: { readOnlyHint: true },
};

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
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

async function connect(): Promise<Client> {
  const dir = mkdtempSync(join(tmpdir(), "ttrpg-mcp-"));
  cleanup.push(() => {
    rmSync(dir, { recursive: true, force: true });
    return Promise.resolve();
  });
  // No bridge: an absent agent token file and a port nothing listens on.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      TTRPG_AGENTS_DB: join(dir, "test.db"),
      BRIDGE_AGENT_TOKEN_FILE: join(dir, "agent-token"),
      BRIDGE_PORT: String(await unusedPort()),
    },
  });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  return client;
}

describe("stdio server", () => {
  it("lists all thirty-one tools and serves a call", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_monsters",
      "apply_damage",
      "change_monster_type",
      "clear_encounter",
      "get_map_image",
      "get_statblock",
      "heal",
      "list_encounter",
      "list_rooms",
      "merge_initiative",
      "move_monsters",
      "preview_monsters",
      "propose_rooms",
      "remove_monsters",
      "remove_rooms",
      "rename_monster",
      "reset_max_hp",
      "restore_encounter",
      "restore_monsters",
      "roll_initiative",
      "search_monsters",
      "set_armor_class",
      "set_hp",
      "set_initiative",
      "set_max_hp",
      "set_rooms",
      "set_stats_visibility",
      "split_initiative",
      "table_status",
      "undo",
      "use_map",
    ]);

    const added = await client.callTool({
      name: "add_monsters",
      arguments: { groups: [{ monster: "srd-2024_shadow", count: 2 }] },
    });
    expect(added.isError).toBeFalsy();
    const listed = await client.callTool({ name: "list_encounter" });
    expect(JSON.stringify(listed.content)).toContain("Shadow 2");
  }, 30_000);

  it("stdio server (spawned via `bin/stdio.mjs`) lists thirty-one tools including `table_status`, its annotations entry is `{ readOnlyHint: true }`, and a call without a running bridge returns an `isError` result", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(31);
    const tableStatus = tools.find((t) => t.name === "table_status");
    expect(tableStatus?.annotations).toEqual({ readOnlyHint: true });

    const result = await client.callTool({ name: "table_status" });
    expect(result.isError).toBe(true);
    // The client's bridge-unreachable message (no token file: start the bridge).
    expect(JSON.stringify(result.content)).toMatch(/bridge/i);
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
