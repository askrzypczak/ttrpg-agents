import {
  getSetupStatus,
  type BridgeAnswer,
  type ConfigProblemFact,
  type DatabaseFile,
} from "@ttrpg-agents/engine";
import { makeTestSetupPorts } from "@ttrpg-agents/engine/testing";
import { describe, expect, it } from "vitest";
import { formatSetupStatus } from "./setup-status.js";

const CONFIG = "/cfg/ttrpg-agents/config.json";
const DB = "/data/ttrpg-agents/encounters.db";
const TOKEN = "/cfg/ttrpg-agents/agent-token";
const POINTERS =
  "Scene sync: the table_status tool. Bridge process: npm run bridge:status.";

type Overrides = Parameters<typeof makeTestSetupPorts>[0];

async function report(overrides: Overrides = {}): Promise<string> {
  return formatSetupStatus(
    await getSetupStatus(
      makeTestSetupPorts({
        ...overrides,
        settings: {
          configFile: { path: CONFIG, found: true },
          ...overrides.settings,
        },
        database: { path: DB, expectedVersion: 15, ...overrides.database },
        bridge: { port: 5199, tokenFile: TOKEN, ...overrides.bridge },
      }),
    ),
  );
}

function withDatabase(file: DatabaseFile): Promise<string> {
  return report({ database: { file } });
}

function withBridge(answer: BridgeAnswer): Promise<string> {
  return report({ bridge: { answer } });
}

function withProblem(problem: ConfigProblemFact): Promise<string> {
  return report({ settings: { problems: [problem] } });
}

/** Asserts `row` is a line of `text` and the next line is `fix`. */
function expectRowWithFix(text: string, row: string, fix: string): void {
  const lines = text.split("\n");
  const at = lines.indexOf(row);
  expect(at, `${row}\n--- in ---\n${text}`).toBeGreaterThan(-1);
  expect(lines[at + 1], row).toBe(`  fix: ${fix}`);
}

describe("formatSetupStatus", () => {
  it('the report opens with "Setup: ready." or "Setup: not ready."', async () => {
    expect((await report()).split("\n")[0]).toBe("Setup: ready.");
    expect((await withBridge({ kind: "unreachable" })).split("\n")[0]).toBe(
      "Setup: not ready.",
    );
  });

  it("each row prints as its state and its text, in the rows' order", async () => {
    const text = await report({
      settings: {
        profile: "dev (linked git worktree)",
        settings: [
          { name: "database", value: DB, source: "file" },
          { name: "bridgePort", value: 5199, source: "environment" },
          { name: "agentTokenFile", value: TOKEN, source: "default" },
        ],
      },
      bridge: { answer: { kind: "gm-tab-connected", roomId: "room-abc" } },
    });
    expect(text).toBe(
      [
        "Setup: ready.",
        "ok: profile dev (linked git worktree)",
        `ok: config file ${CONFIG} (found)`,
        `ok: database = ${DB} (file)`,
        "ok: bridgePort = 5199 (environment)",
        `ok: agentTokenFile = ${TOKEN} (default)`,
        `ok: database ${DB}: schema version 15`,
        "ok: bridge on port 5199: reached",
        "ok: GM tab: connected, room room-abc",
        POINTERS,
      ].join("\n"),
    );

    const noFile = await report({
      settings: { configFile: { path: CONFIG, found: false } },
    });
    expect(noFile.split("\n")).toContain(
      `ok: config file ${CONFIG} (none; optional)`,
    );
  });

  it("each problem and warning row is followed by its fix line, in the wording for its fix code", async () => {
    const startBridge = "start the bridge: npm run bridge:start";
    const reloadTab = "reload the Owlbear tab";
    expectRowWithFix(
      await withDatabase({ kind: "missing" }),
      `problem: database ${DB}: not found`,
      startBridge,
    );
    expectRowWithFix(
      await withDatabase({ kind: "found", version: 12 }),
      `problem: database ${DB}: schema version 12, this build expects 15`,
      "restart the bridge, which migrates the database: npm run bridge:restart",
    );
    expectRowWithFix(
      await withDatabase({ kind: "found", version: 17 }),
      `problem: database ${DB}: schema version 17, this build expects 15`,
      "update this checkout and rebuild (git pull, then npm run build): the database is newer than this build",
    );
    expectRowWithFix(
      await withDatabase({
        kind: "unreadable",
        reason: "file is not a database",
      }),
      `problem: database ${DB}: cannot be read: file is not a database`,
      "point the database setting at the encounter database (see docs/settings.md)",
    );
    expectRowWithFix(
      await withBridge({ kind: "no-token-file" }),
      `problem: bridge on port 5199: never started in this profile (no agent token file at ${TOKEN})`,
      startBridge,
    );
    expectRowWithFix(
      await withBridge({ kind: "unreachable" }),
      "problem: bridge on port 5199: not reached",
      startBridge,
    );
    expectRowWithFix(
      await withBridge({ kind: "token-refused" }),
      "problem: bridge on port 5199: refused this profile's agent token",
      "stop the bridge on port 5199 (npm run bridge:stop in the checkout that started it), then run npm run bridge:start here",
    );
    expectRowWithFix(
      await withBridge({ kind: "no-gm-tab" }),
      "problem: GM tab: none connected",
      "open your Owlbear room as the GM, with the extension installed from http://localhost:5199/manifest.json",
    );
    expectRowWithFix(
      await withBridge({ kind: "gm-tab-not-answering" }),
      "problem: GM tab: connected but not answering",
      reloadTab,
    );
    expectRowWithFix(
      await withBridge({ kind: "gm-tab-connected" }),
      "warning: GM tab: connected, room unknown",
      reloadTab,
    );
  });

  it("a config problem prints the loader's message without its level, and its fix names the key and the config file, or the environment variable", async () => {
    const detail = `config file ${CONFIG}: "bridgePort" must be an integer from 0 to 65535 (got "abc")`;
    expectRowWithFix(
      await withProblem({
        level: "error",
        source: "file",
        key: "bridgePort",
        message: `error: ${detail}`,
      }),
      `problem: ${detail}`,
      `correct "bridgePort" in ${CONFIG} (see docs/settings.md)`,
    );

    const unknown = `config file ${CONFIG}: unknown key "colour" is ignored`;
    expectRowWithFix(
      await withProblem({
        level: "warning",
        source: "file",
        key: "colour",
        message: `warning: ${unknown}`,
      }),
      `warning: ${unknown}`,
      `correct "colour" in ${CONFIG} (see docs/settings.md)`,
    );

    const notObject = `config file ${CONFIG} must hold a JSON object`;
    expectRowWithFix(
      await withProblem({
        level: "error",
        source: "file",
        message: `error: ${notObject}`,
      }),
      `problem: ${notObject}`,
      `correct ${CONFIG} (see docs/settings.md)`,
    );

    const envDetail =
      'environment variable BRIDGE_PORT="x" must be an integer from 0 to 65535';
    expectRowWithFix(
      await withProblem({
        level: "error",
        source: "environment",
        key: "BRIDGE_PORT",
        message: `error: ${envDetail}`,
      }),
      `problem: ${envDetail}`,
      "correct or unset the environment variable BRIDGE_PORT (see docs/settings.md)",
    );
  });

  it("the report ends with the pointers to the table_status tool and npm run bridge:status", async () => {
    for (const text of [
      await report(),
      await withBridge({ kind: "token-refused" }),
    ]) {
      const lines = text.split("\n");
      expect(lines[lines.length - 1]).toBe(POINTERS);
      expect(text.endsWith("\n")).toBe(false);
    }
  });
});
