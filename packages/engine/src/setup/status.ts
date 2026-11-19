import type {
  BackupFacts,
  BridgeFacts,
  ConfigProblemFact,
  DatabaseFacts,
  SettingFact,
  SetupPorts,
  TokeniserFacts,
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
  | { code: "check-database" }
  | { code: "take-backup" }
  | { code: "reinstall-dependencies" };
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
  | { item: "creatures"; state: "ok"; count: number }
  | {
      item: "database";
      state: SetupState;
      database: DatabaseFacts;
      fix?: SetupFix;
    }
  | {
      item: "backup";
      state: "ok" | "warning";
      backups: BackupFacts;
      ageDays?: number;
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
    }
  | {
      item: "tokeniser";
      state: "ok" | "problem";
      tokeniser: TokeniserFacts;
      fix?: SetupFix;
    };
export interface SetupStatus {
  ready: boolean;
  rows: SetupRow[];
}

const DAY_MS = 86_400_000;

/** Asks each probe once and returns the rows in report order; `ready` = no row in state `problem`. */
export async function getSetupStatus(ports: SetupPorts): Promise<SetupStatus> {
  const { settings } = ports;
  const database = ports.database.check();
  const backups = ports.database.checkBackups();
  const [bridge, tokeniser] = await Promise.all([
    ports.bridge.check(),
    ports.tokeniser.check(),
  ]);
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
    ...creaturesRows(database),
    backupRow(backups, ports.now()),
    ...bridgeRows(bridge),
    tokeniserRow(tokeniser),
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

/** The stored creature count of a found database that has a creatures table; none otherwise, as the database row carries any fix. */
function creaturesRows(database: DatabaseFacts): SetupRow[] {
  const { file } = database;
  if (file.kind !== "found" || file.creatureCount === undefined) return [];
  return [{ item: "creatures", state: "ok", count: file.creatureCount }];
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

/** A found backup is ok with its age in whole days (rounded down, never below 0); none or unreadable is a warning. */
function backupRow(backups: BackupFacts, now: Date): SetupRow {
  const { newest } = backups;
  if (newest.kind !== "found")
    return {
      item: "backup",
      state: "warning",
      backups,
      fix: { code: "take-backup" },
    };
  const elapsed = now.getTime() - Date.parse(newest.takenAt);
  const ageDays = Math.max(0, Math.floor(elapsed / DAY_MS));
  return { item: "backup", state: "ok", backups, ageDays };
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

/** A tokeniser whose image library loaded is ok; one that failed is a problem fixed by reinstalling the dependencies. */
function tokeniserRow(tokeniser: TokeniserFacts): SetupRow {
  return tokeniser.kind === "loaded"
    ? { item: "tokeniser", state: "ok", tokeniser }
    : {
        item: "tokeniser",
        state: "problem",
        tokeniser,
        fix: { code: "reinstall-dependencies" },
      };
}
