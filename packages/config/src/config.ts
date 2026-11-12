// Settings for every process: environment, then config.json, then defaults.
// Node built-ins only and no relative imports: root scripts load this file by
// source path under plain node.

export type SettingSource = "environment" | "file" | "default";

export interface Settings {
  /** SQLite file, absolute. */
  database: string;
  /** 0-65535; 0 = any free port. */
  bridgePort: number;
  /** Absolute. */
  agentTokenFile: string;
  /** Absolute; bridge.log sits beside it. */
  bridgeStateFile: string;
  /** Built extension the bridge serves, absolute. */
  extensionDir: string;
}
export type SettingName = keyof Settings;

/** One setting the loader knows. */
export interface SettingSpec {
  name: SettingName;
  /** Environment variable that overrides it. */
  env: string;
  /** Its config.json key, for settings the file may set. */
  fileKey?: string;
}

/** Every setting the loader resolves; drives the loader and the settings-page test. */
export const SETTINGS: readonly SettingSpec[] = [
  { name: "database", env: "TTRPG_AGENTS_DB", fileKey: "database" },
  { name: "bridgePort", env: "BRIDGE_PORT", fileKey: "bridgePort" },
  { name: "agentTokenFile", env: "BRIDGE_AGENT_TOKEN_FILE" },
  { name: "bridgeStateFile", env: "BRIDGE_STATE_FILE" },
  { name: "extensionDir", env: "BRIDGE_STATIC_DIR" },
];

export interface ConfigProblem {
  level: "error" | "warning";
  source: "file" | "environment";
  /** The config.json key or variable name; absent for a problem with the whole file. */
  key?: string;
  /** One printable line naming the level, the source and the key. */
  message: string;
}

export interface LoadedConfig {
  settings: Settings;
  sources: Record<SettingName, SettingSource>;
  configFile: { path: string; found: boolean };
  problems: ConfigProblem[];
}

export interface ConfigInputs {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  /** Absolute path of the checkout the process runs from. */
  checkout: string;
}

/** Environment, then config.json, then defaults. Reports bad input in `problems`; never throws for it. */
export function loadConfig(inputs: ConfigInputs): LoadedConfig {
  void inputs;
  throw new Error("not implemented");
}
