import type {
  BridgeFacts,
  DatabaseFacts,
  SetupFix,
  SetupRow,
  SetupStatus,
} from "@ttrpg-agents/engine";

const POINTERS =
  "Scene sync: the table_status tool. Bridge process: npm run bridge:status.";

/** The setup report as text, one line per row and a fix line under each problem or warning (no trailing newline). */
export function formatSetupStatus(status: SetupStatus): string {
  const lines = [status.ready ? "Setup: ready." : "Setup: not ready."];
  for (const row of status.rows) {
    lines.push(`${row.state}: ${rowText(row)}`);
    if ("fix" in row && row.fix !== undefined)
      lines.push(`  fix: ${fixText(row.fix)}`);
  }
  lines.push(POINTERS);
  return lines.join("\n");
}

function rowText(row: SetupRow): string {
  switch (row.item) {
    case "profile":
      return `profile ${row.profile}`;
    case "config-file":
      return `config file ${row.path} (${row.found ? "found" : "none; optional"})`;
    case "config-problem":
      return row.problem.message.replace(/^(error|warning): /, "");
    case "setting":
      return `${row.setting.name} = ${String(row.setting.value)} (${row.setting.source})`;
    case "database":
      return databaseText(row.database);
    case "bridge":
      return bridgeText(row.bridge);
    case "gm-tab":
      switch (row.tab) {
        case "none":
          return "GM tab: none connected";
        case "not-answering":
          return "GM tab: connected but not answering";
        case "connected":
          return `GM tab: connected, room ${row.roomId ?? "unknown"}`;
      }
  }
}

function databaseText(database: DatabaseFacts): string {
  const { path, expectedVersion, file } = database;
  switch (file.kind) {
    case "missing":
      return `database ${path}: not found`;
    case "unreadable":
      return `database ${path}: cannot be read: ${file.reason}`;
    case "found":
      return file.version === expectedVersion
        ? `database ${path}: schema version ${String(file.version)}`
        : `database ${path}: schema version ${String(file.version)}, this build expects ${String(expectedVersion)}`;
  }
}

function bridgeText(bridge: BridgeFacts): string {
  const { port, tokenFile, answer } = bridge;
  const prefix = `bridge on port ${String(port)}`;
  switch (answer.kind) {
    case "no-token-file":
      return `${prefix}: never started in this profile (no agent token file at ${tokenFile})`;
    case "unreachable":
      return `${prefix}: not reached`;
    case "token-refused":
      return `${prefix}: refused this profile's agent token`;
    case "no-gm-tab":
    case "gm-tab-not-answering":
    case "gm-tab-connected":
      return `${prefix}: reached`;
  }
}

function fixText(fix: SetupFix): string {
  switch (fix.code) {
    case "fix-config":
      if (fix.source === "environment")
        return fix.key === undefined
          ? "correct the environment variables (see docs/settings.md)"
          : `correct or unset the environment variable ${fix.key} (see docs/settings.md)`;
      return fix.key === undefined
        ? `correct ${fix.configFile} (see docs/settings.md)`
        : `correct "${fix.key}" in ${fix.configFile} (see docs/settings.md)`;
    case "start-bridge":
      return "start the bridge: npm run bridge:start";
    case "restart-bridge":
      return "restart the bridge, which migrates the database: npm run bridge:restart";
    case "restart-bridge-in-this-profile":
      return `stop the bridge on port ${String(fix.port)} (npm run bridge:stop in the checkout that started it), then run npm run bridge:start here`;
    case "open-gm-tab":
      return `open your Owlbear room as the GM, with the extension installed from http://localhost:${String(fix.port)}/manifest.json`;
    case "reload-gm-tab":
      return "reload the Owlbear tab";
    case "update-checkout":
      return "update this checkout and rebuild (git pull, then npm run build): the database is newer than this build";
    case "check-database":
      return "point the database setting at the encounter database (see docs/settings.md)";
  }
}
