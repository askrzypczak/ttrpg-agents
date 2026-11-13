// Settings for every process: environment, then config.json, then defaults.
// Node built-ins only and no relative imports: root scripts load this file by
// source path under plain node.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

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
  /** Where npm run db:backup writes, absolute; outside the checkout. */
  backupDir: string;
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
  { name: "backupDir", env: "TTRPG_AGENTS_BACKUP_DIR", fileKey: "backupDir" },
];

export interface ConfigProblem {
  level: "error" | "warning";
  source: "file" | "environment";
  /** The config.json key or variable name; absent for a problem with the whole file. */
  key?: string;
  /** One printable line naming the level, the source and the key. */
  message: string;
}

export type ProfileName = "default" | "dev";
/** Why: TTRPG_AGENTS_PROFILE is set, the checkout is a linked git worktree, or neither. */
export type ProfileReason = "environment" | "worktree" | "none";
export interface Profile {
  name: ProfileName;
  reason: ProfileReason;
}

export interface LoadedConfig {
  profile: Profile;
  settings: Settings;
  sources: Record<SettingName, SettingSource>;
  configFile: { path: string; found: boolean };
  problems: ConfigProblem[];
}

export interface ConfigInputs {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  /** Absolute path of the checkout the process runs from; also decides the profile. */
  checkout: string;
}

const APP_DIR = "ttrpg-agents";
const DEFAULT_BRIDGE_PORT = 5199;
const DEV_BRIDGE_PORT = 5299;
const PROFILE_ENV = "TTRPG_AGENTS_PROFILE";

/** dev for a linked git worktree (its .git is a file), else default. */
function checkoutProfile(checkout: string): Profile {
  try {
    if (statSync(join(resolve(checkout), ".git")).isFile())
      return { name: "dev", reason: "worktree" };
  } catch {
    // No .git, or it cannot be read: not a linked worktree.
  }
  return { name: "default", reason: "none" };
}

/** TTRPG_AGENTS_PROFILE when set, else the checkout kind; an unknown value is a problem. */
function resolveProfile(
  env: ConfigInputs["env"],
  checkout: string,
  problems: ConfigProblem[],
): Profile {
  const raw = env[PROFILE_ENV];
  if (raw === undefined || raw === "") return checkoutProfile(checkout);
  if (raw === "default" || raw === "dev")
    return { name: raw, reason: "environment" };
  problems.push({
    level: "error",
    source: "environment",
    key: PROFILE_ENV,
    message: `error: environment variable ${PROFILE_ENV}=${JSON.stringify(raw)} must be "default" or "dev"`,
  });
  return checkoutProfile(checkout);
}

/** The checkout's own folder in ttrpg-agents/dev/: its folder name and a short hash of its path. */
function devFolder(checkout: string): string {
  const full = resolve(checkout);
  const name = basename(full).replace(/[^A-Za-z0-9._-]/g, "_");
  const hash = createHash("sha256").update(full).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

/** An XDG base directory: used only when set to an absolute path (XDG spec). */
function xdgDir(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== "" && isAbsolute(value)
    ? value
    : fallback;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

function parsePath(raw: unknown, home: string): Parsed<string> {
  if (typeof raw !== "string")
    return { ok: false, reason: "must be a string path" };
  if (raw.startsWith("~/"))
    return { ok: true, value: join(home, raw.slice(2)) };
  if (isAbsolute(raw)) return { ok: true, value: raw };
  return {
    ok: false,
    reason: "must be an absolute path or start with ~/",
  };
}

function checkPort(port: number): Parsed<number> {
  return Number.isInteger(port) && port >= 0 && port <= 65535
    ? { ok: true, value: port }
    : { ok: false, reason: "must be an integer from 0 to 65535" };
}

function parsePortFromFile(raw: unknown): Parsed<number> {
  if (typeof raw !== "number") {
    return { ok: false, reason: "must be an integer from 0 to 65535" };
  }
  return checkPort(raw);
}

function parsePortFromEnv(raw: string): Parsed<number> {
  if (!/^\d+$/.test(raw)) {
    return { ok: false, reason: "must be an integer from 0 to 65535" };
  }
  return checkPort(Number(raw));
}

/** Environment, then config.json, then defaults. Reports bad input in `problems`; never throws for it. */
export function loadConfig(inputs: ConfigInputs): LoadedConfig {
  const { env, home, checkout } = inputs;
  // The profile decides where config.json is, so it comes first.
  const problems: ConfigProblem[] = [];
  const profile = resolveProfile(env, checkout, problems);
  const profileDir = profile.name === "dev" ? ["dev", devFolder(checkout)] : [];
  const configDir = join(
    xdgDir(env["XDG_CONFIG_HOME"], join(home, ".config")),
    APP_DIR,
    ...profileDir,
  );
  const dataDir = join(
    xdgDir(env["XDG_DATA_HOME"], join(home, ".local", "share")),
    APP_DIR,
    ...profileDir,
  );
  const configPath = join(configDir, "config.json");

  const defaults: Settings = {
    database: join(dataDir, "encounters.db"),
    bridgePort: profile.name === "dev" ? DEV_BRIDGE_PORT : DEFAULT_BRIDGE_PORT,
    agentTokenFile: join(configDir, "agent-token"),
    bridgeStateFile: join(configDir, "bridge-state.json"),
    extensionDir: join(checkout, "packages", "owlbear", "dist"),
    backupDir: join(dataDir, "backups"),
  };

  // Read config.json: missing is fine, anything else unreadable is an error.
  let found = false;
  let file: Record<string, unknown> = {};
  let text: string | undefined;
  try {
    text = readFileSync(configPath, "utf8");
    found = true;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code !== "ENOENT") {
      found = true;
      const detail = err instanceof Error ? err.message : String(err);
      problems.push({
        level: "error",
        source: "file",
        message: `error: cannot read config file ${configPath}: ${detail}`,
      });
    }
  }
  if (text !== undefined) {
    let parsed: unknown;
    let parseError: string | undefined;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    if (parseError !== undefined) {
      problems.push({
        level: "error",
        source: "file",
        message: `error: config file ${configPath} is not valid JSON: ${parseError}`,
      });
    } else if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      problems.push({
        level: "error",
        source: "file",
        message: `error: config file ${configPath} must hold a JSON object`,
      });
    } else {
      file = parsed as Record<string, unknown>;
    }
  }

  const fileKeys = new Set(
    SETTINGS.flatMap((spec) =>
      spec.fileKey === undefined ? [] : [spec.fileKey],
    ),
  );
  for (const key of Object.keys(file)) {
    if (!fileKeys.has(key)) {
      problems.push({
        level: "warning",
        source: "file",
        key,
        message: `warning: config file ${configPath}: unknown key "${key}" is ignored`,
      });
    }
  }

  const settings: Settings = { ...defaults };
  const sources = {} as Record<SettingName, SettingSource>;
  const mutable = settings as unknown as Record<SettingName, string | number>;

  for (const spec of SETTINGS) {
    const isPort = spec.name === "bridgePort";
    let fromEnv: Parsed<string | number> | undefined;
    const envRaw = env[spec.env];
    if (envRaw !== undefined && envRaw !== "") {
      fromEnv = isPort ? parsePortFromEnv(envRaw) : parsePath(envRaw, home);
      if (!fromEnv.ok) {
        problems.push({
          level: "error",
          source: "environment",
          key: spec.env,
          message: `error: environment variable ${spec.env}=${JSON.stringify(envRaw)} ${fromEnv.reason}`,
        });
      }
    }
    let fromFile: Parsed<string | number> | undefined;
    if (spec.fileKey !== undefined && Object.hasOwn(file, spec.fileKey)) {
      const raw = file[spec.fileKey];
      fromFile = isPort ? parsePortFromFile(raw) : parsePath(raw, home);
      if (!fromFile.ok) {
        problems.push({
          level: "error",
          source: "file",
          key: spec.fileKey,
          message: `error: config file ${configPath}: "${spec.fileKey}" ${fromFile.reason} (got ${JSON.stringify(raw)})`,
        });
      }
    }
    if (fromEnv?.ok === true) {
      mutable[spec.name] = fromEnv.value;
      sources[spec.name] = "environment";
    } else if (fromFile?.ok === true) {
      mutable[spec.name] = fromFile.value;
      sources[spec.name] = "file";
    } else {
      sources[spec.name] = "default";
    }
  }

  return {
    profile,
    settings,
    sources,
    configFile: { path: configPath, found },
    problems,
  };
}

/** "dev (TTRPG_AGENTS_PROFILE)", "default (TTRPG_AGENTS_PROFILE)", "dev (linked git worktree)" or "default (not a linked git worktree)". */
export function describeProfile(profile: Profile): string {
  const why =
    profile.reason === "environment"
      ? PROFILE_ENV
      : profile.reason === "worktree"
        ? "linked git worktree"
        : "not a linked git worktree";
  return `${profile.name} (${why})`;
}
