import type {
  BridgeFacts,
  ConfigProblemFact,
  DatabaseFacts,
  SettingFact,
  SetupPorts,
} from "./port.js";

export type SetupState = "ok" | "warning" | "problem";
export type SetupFix =
  | {
      code: "fix-config";
      source: "file" | "environment";
      key?: string;
      configFile: string;
    }
  | { code: "start-bridge" }
  | { code: "restart-bridge" }
  | { code: "restart-bridge-in-this-profile"; port: number }
  | { code: "open-gm-tab"; port: number }
  | { code: "reload-gm-tab" }
  | { code: "update-checkout" }
  | { code: "check-database" };
export type SetupRow =
  | { item: "profile"; state: "ok"; profile: string }
  | { item: "config-file"; state: "ok"; path: string; found: boolean }
  | {
      item: "config-problem";
      state: "warning" | "problem";
      problem: ConfigProblemFact;
      fix: SetupFix;
    }
  | { item: "setting"; state: "ok"; setting: SettingFact }
  | {
      item: "database";
      state: SetupState;
      database: DatabaseFacts;
      fix?: SetupFix;
    }
  | { item: "bridge"; state: SetupState; bridge: BridgeFacts; fix?: SetupFix }
  | {
      item: "gm-tab";
      state: SetupState;
      port: number;
      tab: "connected" | "none" | "not-answering";
      roomId?: string;
      fix?: SetupFix;
    };
export interface SetupStatus {
  ready: boolean;
  rows: SetupRow[];
}

/** Asks both probes once and returns the rows in report order; `ready` = no row in state `problem`. */
export async function getSetupStatus(ports: SetupPorts): Promise<SetupStatus> {
  const { settings } = ports;
  const database = ports.database.check();
  const bridge = await ports.bridge.check();
  const rows: SetupRow[] = [
    { item: "profile", state: "ok", profile: settings.profile },
    {
      item: "config-file",
      state: "ok",
      path: settings.configFile.path,
      found: settings.configFile.found,
    },
    ...settings.problems.map((problem) =>
      configProblemRow(problem, settings.configFile.path),
    ),
    ...settings.settings.map((setting): SetupRow => ({
      item: "setting",
      state: "ok",
      setting,
    })),
    databaseRow(database),
    ...bridgeRows(bridge),
  ];
  return { ready: rows.every((row) => row.state !== "problem"), rows };
}

function configProblemRow(
  problem: ConfigProblemFact,
  configFile: string,
): SetupRow {
  const fix: SetupFix = {
    code: "fix-config",
    source: problem.source,
    ...(problem.key === undefined ? {} : { key: problem.key }),
    configFile,
  };
  return {
    item: "config-problem",
    state: problem.level === "error" ? "problem" : "warning",
    problem,
    fix,
  };
}

function databaseRow(database: DatabaseFacts): SetupRow {
  const fix = databaseFix(database);
  return fix === undefined
    ? { item: "database", state: "ok", database }
    : { item: "database", state: "problem", database, fix };
}

function databaseFix(database: DatabaseFacts): SetupFix | undefined {
  const { file, expectedVersion } = database;
  switch (file.kind) {
    case "missing":
      return { code: "start-bridge" };
    case "unreadable":
      return { code: "check-database" };
    case "found":
      if (file.version < expectedVersion) return { code: "restart-bridge" };
      if (file.version > expectedVersion) return { code: "update-checkout" };
      return undefined;
  }
}

function bridgeRows(bridge: BridgeFacts): SetupRow[] {
  const { port, answer } = bridge;
  switch (answer.kind) {
    case "no-token-file":
    case "unreachable":
      return [
        {
          item: "bridge",
          state: "problem",
          bridge,
          fix: { code: "start-bridge" },
        },
      ];
    case "token-refused":
      return [
        {
          item: "bridge",
          state: "problem",
          bridge,
          fix: { code: "restart-bridge-in-this-profile", port },
        },
      ];
    case "no-gm-tab":
      return [
        { item: "bridge", state: "ok", bridge },
        {
          item: "gm-tab",
          state: "problem",
          port,
          tab: "none",
          fix: { code: "open-gm-tab", port },
        },
      ];
    case "gm-tab-not-answering":
      return [
        { item: "bridge", state: "ok", bridge },
        {
          item: "gm-tab",
          state: "problem",
          port,
          tab: "not-answering",
          fix: { code: "reload-gm-tab" },
        },
      ];
    case "gm-tab-connected":
      return [
        { item: "bridge", state: "ok", bridge },
        answer.roomId === undefined
          ? {
              item: "gm-tab",
              state: "warning",
              port,
              tab: "connected",
              fix: { code: "reload-gm-tab" },
            }
          : {
              item: "gm-tab",
              state: "ok",
              port,
              tab: "connected",
              roomId: answer.roomId,
            },
      ];
  }
}
