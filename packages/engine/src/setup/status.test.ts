import { describe, expect, it } from "vitest";
import { makeTestSetupPorts } from "../testing/index.js";
import {
  getSetupStatus,
  type BackupFacts,
  type BridgeAnswer,
  type ConfigProblemFact,
  type DatabaseFile,
  type SettingFact,
  type SetupRow,
} from "./index.js";

const CONFIG = "/home/test/.config/ttrpg-agents/config.json";

function rowsOf(rows: SetupRow[], item: SetupRow["item"]): SetupRow[] {
  return rows.filter((r) => r.item === item);
}

function onlyRow(rows: SetupRow[], item: SetupRow["item"]): SetupRow {
  const found = rowsOf(rows, item);
  expect(found, item).toHaveLength(1);
  return found[0] as SetupRow;
}

function fixOf(row: SetupRow): unknown {
  return "fix" in row ? row.fix : undefined;
}

function withDatabase(file: DatabaseFile) {
  return getSetupStatus(
    makeTestSetupPorts({ database: { expectedVersion: 15, file } }),
  );
}

const BACKUP_DIR = "/home/test/.local/share/ttrpg-agents/backups";

function withBackups(backups: BackupFacts, now: string) {
  return getSetupStatus(makeTestSetupPorts({ backups, now: new Date(now) }));
}

function withBridge(answer: BridgeAnswer) {
  return getSetupStatus(makeTestSetupPorts({ bridge: { port: 5199, answer } }));
}

const fileError: ConfigProblemFact = {
  level: "error",
  source: "file",
  key: "bridgePort",
  message: `error: config file ${CONFIG}: "bridgePort" must be an integer from 0 to 65535 (got "abc")`,
};
const fileWarning: ConfigProblemFact = {
  level: "warning",
  source: "file",
  key: "colour",
  message: `warning: config file ${CONFIG}: unknown key "colour" is ignored`,
};
const settings: SettingFact[] = [
  { name: "database", value: "/data/encounters.db", source: "file" },
  { name: "bridgePort", value: 5300, source: "environment" },
  { name: "agentTokenFile", value: "/cfg/agent-token", source: "default" },
];

describe("getSetupStatus", () => {
  it("rows come in report order: profile, config file, config problems, settings, database, backup, bridge, GM tab", async () => {
    const status = await getSetupStatus(
      makeTestSetupPorts({
        settings: {
          configFile: { path: CONFIG, found: true },
          problems: [fileWarning, fileError],
          settings,
        },
      }),
    );
    expect(status.rows.map((r) => r.item)).toEqual([
      "profile",
      "config-file",
      "config-problem",
      "config-problem",
      "setting",
      "setting",
      "setting",
      "database",
      "backup",
      "bridge",
      "gm-tab",
    ]);
    const problems = rowsOf(status.rows, "config-problem");
    expect(
      problems.map((r) => r.item === "config-problem" && r.problem),
    ).toEqual([fileWarning, fileError]);
  });

  it("a setup whose facts are all in order is ready, and every row is ok", async () => {
    const status = await getSetupStatus(
      makeTestSetupPorts({ settings: { settings } }),
    );
    expect(status.ready).toBe(true);
    expect(status.rows.length).toBeGreaterThan(0);
    for (const row of status.rows) {
      expect(row.state, row.item).toBe("ok");
      expect(fixOf(row), row.item).toBeUndefined();
    }
  });

  it("the profile row is ok and carries the profile description", async () => {
    const status = await getSetupStatus(
      makeTestSetupPorts({
        settings: { profile: "dev (linked git worktree)" },
      }),
    );
    expect(onlyRow(status.rows, "profile")).toEqual({
      item: "profile",
      state: "ok",
      profile: "dev (linked git worktree)",
    });
  });

  it("the config file row is ok whether or not the file was found", async () => {
    for (const found of [true, false]) {
      const status = await getSetupStatus(
        makeTestSetupPorts({
          settings: { configFile: { path: CONFIG, found } },
        }),
      );
      expect(onlyRow(status.rows, "config-file")).toEqual({
        item: "config-file",
        state: "ok",
        path: CONFIG,
        found,
      });
      expect(status.ready).toBe(true);
    }
  });

  it("a config error is a problem row whose fix-config names its source, its key and the config file, and the setup is not ready", async () => {
    const envError: ConfigProblemFact = {
      level: "error",
      source: "environment",
      key: "BRIDGE_PORT",
      message:
        'error: environment variable BRIDGE_PORT="x" must be an integer from 0 to 65535',
    };
    for (const problem of [fileError, envError]) {
      const status = await getSetupStatus(
        makeTestSetupPorts({
          settings: {
            configFile: { path: CONFIG, found: true },
            problems: [problem],
          },
        }),
      );
      expect(onlyRow(status.rows, "config-problem")).toEqual({
        item: "config-problem",
        state: "problem",
        problem,
        fix: {
          code: "fix-config",
          source: problem.source,
          key: problem.key,
          configFile: CONFIG,
        },
      });
      expect(status.ready).toBe(false);
    }
  });

  it("a config warning is a warning row with fix-config, and the setup stays ready", async () => {
    const status = await getSetupStatus(
      makeTestSetupPorts({
        settings: {
          configFile: { path: CONFIG, found: true },
          problems: [fileWarning],
        },
      }),
    );
    expect(onlyRow(status.rows, "config-problem")).toEqual({
      item: "config-problem",
      state: "warning",
      problem: fileWarning,
      fix: {
        code: "fix-config",
        source: "file",
        key: "colour",
        configFile: CONFIG,
      },
    });
    expect(status.ready).toBe(true);
  });

  it("a config problem with the whole file has a fix-config without a key", async () => {
    const wholeFile: ConfigProblemFact = {
      level: "error",
      source: "file",
      message: `error: config file ${CONFIG} must hold a JSON object`,
    };
    const status = await getSetupStatus(
      makeTestSetupPorts({
        settings: {
          configFile: { path: CONFIG, found: true },
          problems: [wholeFile],
        },
      }),
    );
    const row = onlyRow(status.rows, "config-problem");
    expect(row).toMatchObject({
      state: "problem",
      fix: { code: "fix-config", source: "file", configFile: CONFIG },
    });
    expect((fixOf(row) as { key?: string } | undefined)?.key).toBeUndefined();
  });

  it("each setting is an ok row with its name, value and source, in the given order", async () => {
    const status = await getSetupStatus(
      makeTestSetupPorts({ settings: { settings } }),
    );
    expect(rowsOf(status.rows, "setting")).toEqual(
      settings.map((setting) => ({ item: "setting", state: "ok", setting })),
    );
  });

  it("a missing database is a problem with start-bridge", async () => {
    const status = await withDatabase({ kind: "missing" });
    expect(onlyRow(status.rows, "database")).toMatchObject({
      state: "problem",
      database: { expectedVersion: 15, file: { kind: "missing" } },
      fix: { code: "start-bridge" },
    });
    expect(status.ready).toBe(false);
  });

  it("a database older than this build is a problem with restart-bridge", async () => {
    const status = await withDatabase({ kind: "found", version: 12 });
    expect(onlyRow(status.rows, "database")).toMatchObject({
      state: "problem",
      database: { expectedVersion: 15, file: { kind: "found", version: 12 } },
      fix: { code: "restart-bridge" },
    });
    expect(status.ready).toBe(false);
  });

  it("a database newer than this build is a problem with update-checkout", async () => {
    const status = await withDatabase({ kind: "found", version: 17 });
    expect(onlyRow(status.rows, "database")).toMatchObject({
      state: "problem",
      database: { expectedVersion: 15, file: { kind: "found", version: 17 } },
      fix: { code: "update-checkout" },
    });
    expect(status.ready).toBe(false);
  });

  it("an unreadable database is a problem with check-database", async () => {
    const status = await withDatabase({
      kind: "unreadable",
      reason: "file is not a database",
    });
    expect(onlyRow(status.rows, "database")).toMatchObject({
      state: "problem",
      database: {
        file: { kind: "unreadable", reason: "file is not a database" },
      },
      fix: { code: "check-database" },
    });
    expect(status.ready).toBe(false);
  });

  it("a found backup is an ok row carrying the backup facts and its age in whole days, rounded down", async () => {
    const backups: BackupFacts = {
      dir: BACKUP_DIR,
      newest: {
        kind: "found",
        path: `${BACKUP_DIR}/encounters-20261108T120000Z.db`,
        takenAt: "2026-11-08T12:00:00.000Z",
      },
    };
    const cases: [string, number][] = [
      ["2026-11-09T12:00:00.000Z", 1],
      ["2026-11-11T11:59:59.999Z", 2],
      ["2026-11-11T12:00:00.000Z", 3],
      ["2026-11-12T10:00:00.000Z", 3],
    ];
    for (const [now, ageDays] of cases) {
      const status = await withBackups(backups, now);
      expect(onlyRow(status.rows, "backup"), now).toEqual({
        item: "backup",
        state: "ok",
        backups,
        ageDays,
      });
      expect(status.ready, now).toBe(true);
    }
  });

  it("a backup taken less than a day before now, or stamped after now, has age 0", async () => {
    const takenAt = "2026-11-12T09:00:00.000Z";
    const backups: BackupFacts = {
      dir: BACKUP_DIR,
      newest: {
        kind: "found",
        path: `${BACKUP_DIR}/encounters-20261112T090000Z.db`,
        takenAt,
      },
    };
    for (const now of [
      takenAt,
      "2026-11-12T10:00:00.000Z",
      "2026-11-13T08:59:59.999Z",
      "2026-11-12T08:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
    ]) {
      const status = await withBackups(backups, now);
      expect(onlyRow(status.rows, "backup"), now).toEqual({
        item: "backup",
        state: "ok",
        backups,
        ageDays: 0,
      });
    }
  });

  it("no backup is a warning with take-backup, and the setup stays ready", async () => {
    const backups: BackupFacts = { dir: BACKUP_DIR, newest: { kind: "none" } };
    const status = await withBackups(backups, "2026-11-12T10:00:00.000Z");
    const row = onlyRow(status.rows, "backup");
    expect(row).toEqual({
      item: "backup",
      state: "warning",
      backups,
      fix: { code: "take-backup" },
    });
    expect((row as { ageDays?: number }).ageDays).toBeUndefined();
    expect(status.ready).toBe(true);
  });

  it("an unreadable backup directory is a warning with take-backup, and the setup stays ready", async () => {
    const backups: BackupFacts = {
      dir: BACKUP_DIR,
      newest: { kind: "unreadable", reason: "permission denied" },
    };
    const status = await withBackups(backups, "2026-11-12T10:00:00.000Z");
    const row = onlyRow(status.rows, "backup");
    expect(row).toEqual({
      item: "backup",
      state: "warning",
      backups,
      fix: { code: "take-backup" },
    });
    expect((row as { ageDays?: number }).ageDays).toBeUndefined();
    expect(status.ready).toBe(true);
  });

  it("a missing agent token file or an unreachable bridge is a bridge problem with start-bridge, and there is no GM tab row", async () => {
    for (const kind of ["no-token-file", "unreachable"] as const) {
      const status = await withBridge({ kind });
      expect(onlyRow(status.rows, "bridge"), kind).toMatchObject({
        state: "problem",
        bridge: { port: 5199, answer: { kind } },
        fix: { code: "start-bridge" },
      });
      expect(rowsOf(status.rows, "gm-tab"), kind).toEqual([]);
      expect(status.ready, kind).toBe(false);
    }
  });

  it("a bridge that refuses the token is a problem with restart-bridge-in-this-profile naming the port, and there is no GM tab row", async () => {
    const status = await withBridge({ kind: "token-refused" });
    expect(onlyRow(status.rows, "bridge")).toMatchObject({
      state: "problem",
      bridge: { port: 5199, answer: { kind: "token-refused" } },
      fix: { code: "restart-bridge-in-this-profile", port: 5199 },
    });
    expect(rowsOf(status.rows, "gm-tab")).toEqual([]);
    expect(status.ready).toBe(false);
  });

  it("a reached bridge with no GM tab gives an ok bridge row and a GM tab problem with open-gm-tab naming the port", async () => {
    const status = await withBridge({ kind: "no-gm-tab" });
    const bridge = onlyRow(status.rows, "bridge");
    expect(bridge.state).toBe("ok");
    expect(fixOf(bridge)).toBeUndefined();
    expect(onlyRow(status.rows, "gm-tab")).toMatchObject({
      state: "problem",
      port: 5199,
      tab: "none",
      fix: { code: "open-gm-tab", port: 5199 },
    });
    expect(status.ready).toBe(false);
  });

  it("a GM tab that does not answer is a problem with reload-gm-tab", async () => {
    const status = await withBridge({ kind: "gm-tab-not-answering" });
    expect(onlyRow(status.rows, "bridge").state).toBe("ok");
    expect(onlyRow(status.rows, "gm-tab")).toMatchObject({
      state: "problem",
      tab: "not-answering",
      fix: { code: "reload-gm-tab" },
    });
    expect(status.ready).toBe(false);
  });

  it("a connected GM tab without a room id is a warning with reload-gm-tab, and the setup stays ready", async () => {
    const status = await withBridge({ kind: "gm-tab-connected" });
    const tab = onlyRow(status.rows, "gm-tab");
    expect(tab).toMatchObject({
      state: "warning",
      tab: "connected",
      fix: { code: "reload-gm-tab" },
    });
    expect((tab as { roomId?: string }).roomId).toBeUndefined();
    expect(status.ready).toBe(true);
  });

  it("a connected GM tab with a room id is ok and carries the room id", async () => {
    const status = await withBridge({
      kind: "gm-tab-connected",
      roomId: "room-xyz",
    });
    expect(onlyRow(status.rows, "gm-tab")).toEqual({
      item: "gm-tab",
      state: "ok",
      port: 5199,
      tab: "connected",
      roomId: "room-xyz",
    });
    expect(status.ready).toBe(true);
  });
});
