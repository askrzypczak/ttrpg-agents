import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  SqliteEncounterDirectory,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolAnnotations } from "./tools.js";

const entry = fileURLToPath(new URL("../bin/stdio.mjs", import.meta.url));

const expectedAnnotations: Record<string, ToolAnnotations | undefined> = {
  search_monsters: { readOnlyHint: true },
  get_statblock: { readOnlyHint: true },
  open_statblock: { readOnlyHint: true },
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
  setup_status: { readOnlyHint: true },
  use_map: { destructiveHint: false },
  set_rooms: { destructiveHint: true },
  list_rooms: { readOnlyHint: true },
  remove_rooms: { destructiveHint: true },
  get_map_image: { readOnlyHint: true },
  propose_rooms: { readOnlyHint: true },
  list_encounters: { readOnlyHint: true },
  rename_encounter: { destructiveHint: true },
  use_encounter: { destructiveHint: false },
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
  it("lists all thirty-six tools and serves a call", async () => {
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
      "list_encounters",
      "list_rooms",
      "merge_initiative",
      "move_monsters",
      "open_statblock",
      "preview_monsters",
      "propose_rooms",
      "remove_monsters",
      "remove_rooms",
      "rename_encounter",
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
      "setup_status",
      "split_initiative",
      "table_status",
      "undo",
      "use_encounter",
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

  it("stdio server (spawned via `bin/stdio.mjs`) lists thirty-six tools including `table_status` and `setup_status`, its annotations entry is `{ readOnlyHint: true }`, and a call without a running bridge returns an `isError` result", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(36);
    expect(tools.map((t) => t.name)).toContain("setup_status");
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

const PROJECT_VARIABLES = new Set([
  "TTRPG_AGENTS_DB",
  "BRIDGE_PORT",
  "BRIDGE_AGENT_TOKEN_FILE",
  "BRIDGE_STATE_FILE",
  "BRIDGE_STATIC_DIR",
  "TTRPG_AGENTS_BACKUP_DIR",
]);

/**
 * A temp HOME and XDG config directory, and a child environment with no
 * project variables and no other XDG variables, so only config.json (or the
 * defaults under the temp HOME) can name the database and port.
 */
function isolatedHome(): {
  home: string;
  env: Record<string, string>;
  writeConfig: (content: unknown) => void;
} {
  const home = mkdtempSync(join(tmpdir(), "ttrpg-mcp-home-"));
  const configHome = mkdtempSync(join(tmpdir(), "ttrpg-mcp-xdg-"));
  cleanup.push(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
    return Promise.resolve();
  });
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || PROJECT_VARIABLES.has(name)) continue;
    if (name.startsWith("XDG_")) continue;
    env[name] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = configHome;
  // config.json goes in the default profile's directory, whatever the checkout.
  env.TTRPG_AGENTS_PROFILE = "default";
  return {
    home,
    env,
    writeConfig(content) {
      const dir = join(configHome, "ttrpg-agents");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "config.json"), JSON.stringify(content));
    },
  };
}

interface Finished {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the server with stdin closed; kills it if it is still running at the deadline. */
function runToExit(
  env: Record<string, string>,
  deadlineMs = 10_000,
): Promise<Finished> {
  const child = spawn(process.execPath, [entry], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  cleanup.push(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    return Promise.resolve();
  });
  child.stdin.end();
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

describe("stdio server settings", () => {
  it("the MCP server spawned with no project environment variables writes to the database config.json names", async () => {
    const { home, env, writeConfig } = isolatedHome();
    writeConfig({
      database: "~/games/encounters.db",
      bridgePort: await unusedPort(),
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env,
    });
    const client = new Client({ name: "settings", version: "0.0.0" });
    cleanup.push(() => client.close());
    await client.connect(transport);
    const added = await client.callTool({
      name: "add_monsters",
      arguments: { groups: [{ monster: "srd-2024_shadow", count: 1 }] },
    });
    expect(added.isError).toBeFalsy();
    await client.close();

    const configured = join(home, "games", "encounters.db");
    expect(existsSync(configured), "the configured database exists").toBe(true);
    const db = openDatabase(configured);
    try {
      const names = currentNames(db);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^Shadow/);
    } finally {
      db.close();
    }
    expect(
      existsSync(
        join(home, ".local", "share", "ttrpg-agents", "encounters.db"),
      ),
      "the default database was not created",
    ).toBe(false);
  }, 30_000);

  it("the MCP server exits 1 with a stderr line naming bridgePort and nothing on stdout when config.json has an invalid bridgePort", async () => {
    const { env, writeConfig } = isolatedHome();
    writeConfig({ bridgePort: "abc" });

    const result = await runToExit(env);

    expect(result.code, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/^.*bridgePort.*$/m);
    expect(result.stdout).toBe("");
  }, 30_000);
});

/** The checkout the spawned server runs from (the repository root). */
const checkout = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
/** Its folder name as the dev profile's folder starts with it. */
const checkoutFolder = basename(checkout).replace(/[^A-Za-z0-9._-]/g, "_");

/** Spawns the server with `env`, adds one Shadow and closes it. */
async function addShadowWith(env: Record<string, string>): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env,
  });
  const client = new Client({ name: "profile", version: "0.0.0" });
  cleanup.push(() => client.close());
  await client.connect(transport);
  const added = await client.callTool({
    name: "add_monsters",
    arguments: { groups: [{ monster: "srd-2024_shadow", count: 1 }] },
  });
  expect(added.isError).toBeFalsy();
  await client.close();
}

/** Display names of the current encounter in `db`; none when no encounter is current. */
function currentNames(db: DatabaseSync): string[] {
  const encounters = new SqliteEncounterDirectory(db);
  const current = encounters.getCurrentEncounter();
  if (!current) return [];
  return encounters
    .repositoryFor(current.id)
    .listInstances()
    .map((i) => i.displayName);
}

/** Display names of the current encounter in the database at `path`. */
function namesIn(path: string): string[] {
  const db = openDatabase(path);
  try {
    return currentNames(db);
  } finally {
    db.close();
  }
}

/** The first path segment of `path` below the temp directory, or undefined if it is not below it. */
function tempRunOf(path: string): string | undefined {
  if (!isAbsolute(path)) return undefined;
  const rel = relative(tmpdir(), path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep)[0];
}

describe("stdio server profile", () => {
  it("the MCP server spawned with TTRPG_AGENTS_PROFILE=dev, no path overrides and temp XDG directories creates its database in this checkout's folder under <data>/ttrpg-agents/dev/", async () => {
    const { home, env } = isolatedHome();
    const dataHome = mkdtempSync(join(tmpdir(), "ttrpg-mcp-data-"));
    cleanup.push(() => {
      rmSync(dataHome, { recursive: true, force: true });
      return Promise.resolve();
    });
    env.XDG_DATA_HOME = dataHome;
    env.TTRPG_AGENTS_PROFILE = "dev";
    env.BRIDGE_PORT = String(await unusedPort());

    await addShadowWith(env);

    const devDir = join(dataHome, "ttrpg-agents", "dev");
    const folders = existsSync(devDir) ? readdirSync(devDir) : [];
    expect(folders, `one folder under ${devDir}`).toHaveLength(1);
    const folder = folders[0] ?? "";
    expect(folder.startsWith(`${checkoutFolder}-`), folder).toBe(true);
    expect(folder.slice(checkoutFolder.length + 1)).toMatch(/^[0-9a-f]{8}$/);
    const database = join(devDir, folder, "encounters.db");
    expect(existsSync(database), "the dev database exists").toBe(true);
    expect(namesIn(database)).toHaveLength(1);
    expect(
      existsSync(join(dataHome, "ttrpg-agents", "encounters.db")),
      "no default-profile database under the data directory",
    ).toBe(false);
    expect(
      existsSync(
        join(home, ".local", "share", "ttrpg-agents", "encounters.db"),
      ),
      "no default-profile database under HOME",
    ).toBe(false);
  }, 30_000);

  it("the MCP server spawned with the test run's environment and no path overrides opens its database inside the run's temp directory", async () => {
    // Checked before anything is spawned, so a run without the isolation never
    // starts a server that could open a real database.
    const configHome = process.env.XDG_CONFIG_HOME;
    const dataHome = process.env.XDG_DATA_HOME;
    expect(configHome, "XDG_CONFIG_HOME is set").toBeTypeOf("string");
    expect(dataHome, "XDG_DATA_HOME is set").toBeTypeOf("string");
    const configRun = tempRunOf(configHome ?? "");
    const dataRun = tempRunOf(dataHome ?? "");
    expect(
      configRun,
      `${String(configHome)} is under the temp directory`,
    ).toMatch(/^ttrpg-agents-test-/);
    expect(dataRun, "both XDG directories are in one run directory").toBe(
      configRun,
    );
    expect(resolve(configHome ?? "")).not.toBe(join(tmpdir(), configRun ?? ""));
    expect(resolve(dataHome ?? "")).not.toBe(join(tmpdir(), dataRun ?? ""));
    for (const name of PROJECT_VARIABLES)
      expect(process.env[name], `${name} is not set`).toBeUndefined();

    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env))
      if (value !== undefined) env[name] = value;
    await addShadowWith(env);

    const runDir = join(tmpdir(), configRun ?? "");
    const databases = readdirSync(runDir, { recursive: true, encoding: "utf8" })
      .filter((path) => basename(path) === "encounters.db")
      .map((path) => join(runDir, path));
    expect(
      databases.some((path) =>
        namesIn(path).some((name) => name.startsWith("Shadow")),
      ),
      `a database under ${runDir} holds the added Shadow`,
    ).toBe(true);
  }, 30_000);
});
